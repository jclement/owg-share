import { createMiddleware } from "hono/factory";
import type { Env } from "../types";
import { error } from "../lib/response";

type RateLimitEnv = {
  Bindings: Env;
};

export function rateLimit(limit: number, windowSecs: number) {
  return createMiddleware<RateLimitEnv>(async (c, next) => {
    const ip = c.req.header("CF-Connecting-IP") || "unknown";
    const path = new URL(c.req.url).pathname;
    const key = `ratelimit:${ip}:${path}`;

    const current = await c.env.KV.get(key);
    const count = current ? parseInt(current) : 0;

    if (count >= limit) {
      return error("Rate limit exceeded", "RATE_LIMITED", 429);
    }

    await c.env.KV.put(key, String(count + 1), { expirationTtl: windowSecs });
    await next();
  });
}
