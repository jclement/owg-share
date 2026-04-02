import { Hono } from "hono";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";
import type { Env, User, Passkey } from "../types";
import { json, error } from "../lib/response";
import { createSession, getSession, getSessionToken, deleteSession, sessionCookie, clearSessionCookie } from "../lib/session";
import { rateLimit } from "../middleware/ratelimit";

type AuthApp = { Bindings: Env; Variables: { userId: string } };

const auth = new Hono<AuthApp>();

// Rate limit auth endpoints (generous — passkeys are brute-force resistant)
auth.use("/*", rateLimit(120, 60));

// Check auth status & if system needs setup
auth.get("/status", async (c) => {
  const userCount = await c.env.DB.prepare("SELECT COUNT(*) as count FROM users").first<{ count: number }>();
  const needsSetup = !userCount || userCount.count === 0;

  const token = getSessionToken(c.req.raw);
  if (!token) {
    return json({ authenticated: false, needsSetup, appName: c.env.APP_NAME });
  }

  const session = await getSession(c.env, token);
  if (!session) {
    return json({ authenticated: false, needsSetup, appName: c.env.APP_NAME });
  }

  const user = await c.env.DB.prepare("SELECT id, username, created_at FROM users WHERE id = ?")
    .bind(session.userId)
    .first<User>();

  if (!user) {
    return json({ authenticated: false, needsSetup, appName: c.env.APP_NAME });
  }

  return json({ authenticated: true, needsSetup: false, user, appName: c.env.APP_NAME });
});

// Registration - generate options
auth.post("/register/options", async (c) => {
  const body = await c.req.json<{ username: string }>();
  if (!body.username || body.username.trim().length === 0) {
    return error("Username is required", "VALIDATION_ERROR");
  }

  const username = body.username.trim();

  // Check if any users exist (only allow registration if none exist, or if authenticated)
  const userCount = await c.env.DB.prepare("SELECT COUNT(*) as count FROM users").first<{ count: number }>();
  const isFirstUser = !userCount || userCount.count === 0;

  if (!isFirstUser) {
    // Must be authenticated to add new users
    const token = getSessionToken(c.req.raw);
    if (!token) return error("Authentication required", "UNAUTHORIZED", 401);
    const session = await getSession(c.env, token);
    if (!session) return error("Session expired", "SESSION_EXPIRED", 401);
  }

  // Check username uniqueness
  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
  if (existing) {
    return error("Username already taken", "USERNAME_TAKEN", 409);
  }

  const userId = crypto.randomUUID();

  const options = await generateRegistrationOptions({
    rpName: c.env.APP_NAME,
    rpID: c.env.RP_ID,
    userID: new TextEncoder().encode(userId) as Uint8Array<ArrayBuffer>,
    userName: username,
    userDisplayName: username,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  // Store challenge in KV with 5-minute TTL
  await c.env.KV.put(
    `challenge:reg:${userId}`,
    JSON.stringify({ challenge: options.challenge, username }),
    { expirationTtl: 300 }
  );

  return json({ ...options, userId });
});

// Registration - verify
auth.post("/register/verify", async (c) => {
  const body = await c.req.json<{ userId: string; credential: unknown }>();

  const challengeData = await c.env.KV.get(`challenge:reg:${body.userId}`);
  if (!challengeData) {
    return error("Registration challenge expired", "CHALLENGE_EXPIRED");
  }

  const { challenge, username } = JSON.parse(challengeData);

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.credential as Parameters<typeof verifyRegistrationResponse>[0]["response"],
      expectedChallenge: challenge,
      expectedOrigin: c.env.RP_ORIGIN,
      expectedRPID: c.env.RP_ID,
    });
  } catch (e) {
    return error(`Verification failed: ${e instanceof Error ? e.message : "Unknown error"}`, "VERIFICATION_FAILED");
  }

  if (!verification.verified || !verification.registrationInfo) {
    return error("Registration verification failed", "VERIFICATION_FAILED");
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  // Create user and passkey in a batch
  // IMPORTANT: Use the WebAuthn credential ID as the passkey primary key
  // so we can look it up during authentication
  const userId = body.userId;

  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO users (id, username) VALUES (?, ?)"
    ).bind(userId, username),
    c.env.DB.prepare(
      "INSERT INTO passkeys (id, user_id, public_key, counter, device_type, backed_up, transports, name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      credential.id,
      userId,
      credential.publicKey,
      credential.counter,
      credentialDeviceType,
      credentialBackedUp ? 1 : 0,
      JSON.stringify(credential.transports || []),
      "Default passkey"
    ),
  ]);

  // Clean up challenge
  await c.env.KV.delete(`challenge:reg:${userId}`);

  // Create session
  const token = await createSession(c.env, userId);

  return new Response(
    JSON.stringify({ success: true, data: { verified: true } }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": sessionCookie(token),
      },
    }
  );
});

// Login - generate options
auth.post("/login/options", async (c) => {
  const options = await generateAuthenticationOptions({
    rpID: c.env.RP_ID,
    userVerification: "preferred",
  });

  const challengeId = crypto.randomUUID();
  await c.env.KV.put(
    `challenge:auth:${challengeId}`,
    JSON.stringify({ challenge: options.challenge }),
    { expirationTtl: 300 }
  );

  return json({ ...options, challengeId });
});

// Login - verify
auth.post("/login/verify", async (c) => {
  const body = await c.req.json<{ challengeId: string; credential: unknown }>();

  const challengeData = await c.env.KV.get(`challenge:auth:${body.challengeId}`);
  if (!challengeData) {
    return error("Authentication challenge expired", "CHALLENGE_EXPIRED");
  }

  const { challenge } = JSON.parse(challengeData);
  const credentialResponse = body.credential as { id: string; response: { authenticatorData: string } } & Parameters<typeof verifyAuthenticationResponse>[0]["response"];

  // Find the passkey by its WebAuthn credential ID (stored as the primary key)
  const passkey = await c.env.DB.prepare(
    "SELECT * FROM passkeys WHERE id = ?"
  )
    .bind(credentialResponse.id)
    .first<Passkey>();

  if (!passkey) {
    return error("Passkey not found", "PASSKEY_NOT_FOUND", 401);
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: credentialResponse,
      expectedChallenge: challenge,
      expectedOrigin: c.env.RP_ORIGIN,
      expectedRPID: c.env.RP_ID,
      credential: {
        id: passkey.id,
        publicKey: new Uint8Array(passkey.public_key),
        counter: passkey.counter,
        transports: passkey.transports ? JSON.parse(passkey.transports) as AuthenticatorTransportFuture[] : undefined,
      },
    });
  } catch (e) {
    return error(`Authentication failed: ${e instanceof Error ? e.message : "Unknown error"}`, "AUTH_FAILED", 401);
  }

  if (!verification.verified) {
    return error("Authentication verification failed", "AUTH_FAILED", 401);
  }

  // Update counter and last used
  await c.env.DB.prepare(
    "UPDATE passkeys SET counter = ?, last_used_at = datetime('now') WHERE id = ?"
  )
    .bind(verification.authenticationInfo.newCounter, passkey.id)
    .run();

  // Clean up challenge
  await c.env.KV.delete(`challenge:auth:${body.challengeId}`);

  // Create session
  const token = await createSession(c.env, passkey.user_id);

  return new Response(
    JSON.stringify({ success: true, data: { verified: true } }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": sessionCookie(token),
      },
    }
  );
});

// Logout
auth.post("/logout", async (c) => {
  const token = getSessionToken(c.req.raw);
  if (token) {
    await deleteSession(c.env, token);
  }

  return new Response(
    JSON.stringify({ success: true, data: { loggedOut: true } }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": clearSessionCookie(),
      },
    }
  );
});

export default auth;
