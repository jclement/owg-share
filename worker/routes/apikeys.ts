import { Hono } from "hono";
import type { Env } from "../types";
import { json, error } from "../lib/response";
import { requireAuth } from "../middleware/auth";
import { generateApiKey, hashApiKey } from "../lib/crypto";

type ApiKeyApp = { Bindings: Env; Variables: { userId: string } };

const apikeys = new Hono<ApiKeyApp>();

apikeys.use("/*", requireAuth);

// List API keys
apikeys.get("/", async (c) => {
  const userId = c.get("userId");
  const results = await c.env.DB.prepare(
    "SELECT id, name, key_prefix, expires_at, last_used_at, last_used_ip, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC"
  )
    .bind(userId)
    .all();

  return json(results.results);
});

// Create API key
apikeys.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ name: string; expires_at?: string }>();

  if (!body.name || body.name.trim().length === 0) {
    return error("Name is required", "VALIDATION_ERROR");
  }

  const rawKey = generateApiKey();
  const keyHash = await hashApiKey(rawKey);
  const keyPrefix = rawKey.slice(0, 12);
  const id = crypto.randomUUID();

  await c.env.DB.prepare(
    "INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(id, userId, body.name.trim(), keyHash, keyPrefix, body.expires_at || null)
    .run();

  // Return the raw key ONCE — it can never be retrieved again
  return json({ id, name: body.name.trim(), key: rawKey, key_prefix: keyPrefix }, 201);
});

// Delete API key
apikeys.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const result = await c.env.DB.prepare(
    "DELETE FROM api_keys WHERE id = ? AND user_id = ?"
  )
    .bind(id, userId)
    .run();

  if (!result.meta.changes) {
    return error("API key not found", "NOT_FOUND", 404);
  }

  return json({ deleted: true });
});

export default apikeys;
