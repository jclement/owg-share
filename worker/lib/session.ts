import type { Env, Session } from "../types";

const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days in seconds
const COOKIE_NAME = "session";

export async function createSession(env: Env, userId: string): Promise<string> {
  const token = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL * 1000);

  const session: Session = {
    userId,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  await env.KV.put(`session:${token}`, JSON.stringify(session), {
    expirationTtl: SESSION_TTL,
  });

  return token;
}

export async function getSession(env: Env, token: string): Promise<Session | null> {
  const data = await env.KV.get(`session:${token}`);
  if (!data) return null;

  const session: Session = JSON.parse(data);
  if (new Date(session.expiresAt) < new Date()) {
    await env.KV.delete(`session:${token}`);
    return null;
  }

  return session;
}

export async function deleteSession(env: Env, token: string): Promise<void> {
  await env.KV.delete(`session:${token}`);
}

export function getSessionToken(request: Request): string | null {
  const cookie = request.headers.get("Cookie");
  if (!cookie) return null;

  const match = cookie.split(";").find((c) => c.trim().startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;

  return match.split("=")[1].trim();
}

export function sessionCookie(token: string, maxAge = SESSION_TTL): string {
  const secure = true; // Always secure - Workers are always HTTPS
  return [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
    `Max-Age=${maxAge}`,
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearSessionCookie(): string {
  return sessionCookie("", 0);
}
