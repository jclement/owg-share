import { createMiddleware } from "hono/factory";
import type { Env } from "../types";
import { hashApiKey } from "../lib/crypto";
import { error } from "../lib/response";

type ApiKeyEnv = {
  Bindings: Env;
  Variables: { userId: string };
};

export const requireApiKey = createMiddleware<ApiKeyEnv>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return error("API key required", "UNAUTHORIZED", 401);
  }

  const key = authHeader.slice(7);
  const keyHash = await hashApiKey(key);

  const apiKey = await c.env.DB.prepare(
    "SELECT user_id, expires_at FROM api_keys WHERE key_hash = ?"
  )
    .bind(keyHash)
    .first<{ user_id: string; expires_at: string | null }>();

  if (!apiKey) {
    return error("Invalid API key", "INVALID_API_KEY", 401);
  }

  if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
    return error("API key expired", "API_KEY_EXPIRED", 401);
  }

  // Update last used
  const ip = c.req.header("CF-Connecting-IP") || "unknown";
  await c.env.DB.prepare(
    "UPDATE api_keys SET last_used_at = datetime('now'), last_used_ip = ? WHERE key_hash = ?"
  )
    .bind(ip, keyHash)
    .run();

  c.set("userId", apiKey.user_id);
  await next();
});
