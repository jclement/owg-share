import { Hono } from "hono";
import { generateRegistrationOptions, verifyRegistrationResponse } from "@simplewebauthn/server";
import type { Env, Passkey } from "../types";
import { json, error } from "../lib/response";
import { requireAuth } from "../middleware/auth";
import { createSession, sessionCookie } from "../lib/session";

type PasskeyApp = { Bindings: Env; Variables: { userId: string } };

const passkeys = new Hono<PasskeyApp>();

passkeys.use("/*", requireAuth);

// List passkeys
passkeys.get("/", async (c) => {
  const userId = c.get("userId");
  const results = await c.env.DB.prepare(
    "SELECT id, name, device_type, backed_up, transports, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at"
  )
    .bind(userId)
    .all();

  return json(results.results);
});

// Rename passkey
passkeys.put("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json<{ name: string }>();

  if (!body.name || body.name.trim().length === 0) {
    return error("Name is required", "VALIDATION_ERROR");
  }

  const result = await c.env.DB.prepare(
    "UPDATE passkeys SET name = ? WHERE id = ? AND user_id = ?"
  )
    .bind(body.name.trim(), id, userId)
    .run();

  if (!result.meta.changes) {
    return error("Passkey not found", "NOT_FOUND", 404);
  }

  return json({ updated: true });
});

// Delete passkey
passkeys.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  // Prevent deleting the last passkey
  const count = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM passkeys WHERE user_id = ?"
  )
    .bind(userId)
    .first<{ count: number }>();

  if (!count || count.count <= 1) {
    return error("Cannot delete your only passkey", "LAST_PASSKEY", 400);
  }

  const result = await c.env.DB.prepare(
    "DELETE FROM passkeys WHERE id = ? AND user_id = ?"
  )
    .bind(id, userId)
    .run();

  if (!result.meta.changes) {
    return error("Passkey not found", "NOT_FOUND", 404);
  }

  return json({ deleted: true });
});

// Register new passkey - options
passkeys.post("/register/options", async (c) => {
  const userId = c.get("userId");

  const user = await c.env.DB.prepare("SELECT username FROM users WHERE id = ?")
    .bind(userId)
    .first<{ username: string }>();

  if (!user) {
    return error("User not found", "NOT_FOUND", 404);
  }

  // Get existing passkeys to exclude
  const existingPasskeys = await c.env.DB.prepare(
    "SELECT id, transports FROM passkeys WHERE user_id = ?"
  )
    .bind(userId)
    .all<{ id: string; transports: string | null }>();

  const options = await generateRegistrationOptions({
    rpName: c.env.APP_NAME,
    rpID: c.env.RP_ID,
    userID: new TextEncoder().encode(userId) as Uint8Array<ArrayBuffer>,
    userName: user.username,
    userDisplayName: user.username,
    attestationType: "none",
    excludeCredentials: existingPasskeys.results.map((pk) => ({
      id: pk.id,
      transports: pk.transports ? JSON.parse(pk.transports) : undefined,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  await c.env.KV.put(
    `challenge:reg:${userId}`,
    JSON.stringify({ challenge: options.challenge }),
    { expirationTtl: 300 }
  );

  return json(options);
});

// Register new passkey - verify
passkeys.post("/register/verify", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ credential: unknown; name?: string }>();

  const challengeData = await c.env.KV.get(`challenge:reg:${userId}`);
  if (!challengeData) {
    return error("Challenge expired", "CHALLENGE_EXPIRED");
  }

  const { challenge } = JSON.parse(challengeData);

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
    return error("Verification failed", "VERIFICATION_FAILED");
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  // Use the WebAuthn credential ID as the passkey primary key
  await c.env.DB.prepare(
    "INSERT INTO passkeys (id, user_id, public_key, counter, device_type, backed_up, transports, name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    credential.id,
    userId,
    credential.publicKey,
    credential.counter,
    credentialDeviceType,
    credentialBackedUp ? 1 : 0,
    JSON.stringify(credential.transports || []),
    body.name || "New passkey"
  ).run();

  await c.env.KV.delete(`challenge:reg:${userId}`);

  return json({ verified: true, id: credential.id });
});

export default passkeys;
