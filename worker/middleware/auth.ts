import { createMiddleware } from "hono/factory";
import type { Env } from "../types";
import { getSession, getSessionToken } from "../lib/session";
import { error } from "../lib/response";

type AuthEnv = {
  Bindings: Env;
  Variables: { userId: string };
};

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const token = getSessionToken(c.req.raw);
  if (!token) {
    return error("Authentication required", "UNAUTHORIZED", 401);
  }

  const session = await getSession(c.env, token);
  if (!session) {
    return error("Session expired", "SESSION_EXPIRED", 401);
  }

  c.set("userId", session.userId);
  await next();
});
