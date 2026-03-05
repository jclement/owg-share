import { createMiddleware } from "hono/factory";
import type { Env } from "../types";
import { getSession, getSessionToken } from "../lib/session";
import { hashApiKey } from "../lib/crypto";
import { error } from "../lib/response";

type AuthEnv = {
  Bindings: Env;
  Variables: { userId: string };
};

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  // Try session cookie first
  const token = getSessionToken(c.req.raw);
  if (token) {
    const session = await getSession(c.env, token);
    if (session) {
      c.set("userId", session.userId);
      return next();
    }
  }

  // Fall back to API key Bearer token
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const key = authHeader.slice(7);
    const keyHash = await hashApiKey(key);

    const apiKey = await c.env.DB.prepare(
      "SELECT user_id, expires_at FROM api_keys WHERE key_hash = ?"
    )
      .bind(keyHash)
      .first<{ user_id: string; expires_at: string | null }>();

    if (apiKey) {
      if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
        return error("API key expired", "API_KEY_EXPIRED", 401);
      }

      // Update last used (non-blocking)
      const ip = c.req.header("CF-Connecting-IP") || "unknown";
      c.executionCtx.waitUntil(
        c.env.DB.prepare(
          "UPDATE api_keys SET last_used_at = datetime('now'), last_used_ip = ? WHERE key_hash = ?"
        )
          .bind(ip, keyHash)
          .run()
      );

      c.set("userId", apiKey.user_id);
      return next();
    }
  }

  return error("Authentication required", "UNAUTHORIZED", 401);
});
