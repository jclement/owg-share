import { Hono } from "hono";
import type { Env } from "./types";
import auth from "./routes/auth";
import shares from "./routes/shares";
import upload from "./routes/upload";
import publicRoutes from "./routes/public";
import passkeys from "./routes/passkeys";
import apikeys from "./routes/apikeys";
import v1 from "./routes/v1";

type AppEnv = { Bindings: Env };

const app = new Hono<AppEnv>();

// Security headers for API responses
app.use("/api/*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
});

// Mount route groups
app.route("/api/auth", auth);
app.route("/api/shares", shares);
app.route("/api/upload", upload);
app.route("/api/passkeys", passkeys);
app.route("/api/apikeys", apikeys);
app.route("/api/v1", v1);

// Public share routes
app.route("/s", publicRoutes);

// Health check
app.get("/api/health", (c) => c.json({ status: "ok" }));

// Everything else falls through to static assets via run_worker_first config

export default {
  fetch: app.fetch,

  // Cron trigger for cleanup
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(cleanupExpiredShares(env));
  },
} satisfies ExportedHandler<Env>;

async function cleanupExpiredShares(env: Env) {
  // Find expired shares
  const expired = await env.DB.prepare(
    "SELECT id, type FROM shares WHERE expires_at IS NOT NULL AND expires_at < datetime('now')"
  ).all<{ id: string; type: string }>();

  if (expired.results.length === 0) return;

  // Delete R2 objects for file and gallery shares
  for (const share of expired.results) {
    if (share.type === "file") {
      const fileData = await env.DB.prepare(
        "SELECT r2_key FROM file_shares WHERE share_id = ?"
      ).bind(share.id).first<{ r2_key: string }>();
      if (fileData) await env.R2.delete(fileData.r2_key);
    } else if (share.type === "gallery") {
      const gallery = await env.DB.prepare(
        "SELECT id FROM gallery_shares WHERE share_id = ?"
      ).bind(share.id).first<{ id: string }>();
      if (gallery) {
        const images = await env.DB.prepare(
          "SELECT r2_key FROM gallery_images WHERE gallery_id = ?"
        ).bind(gallery.id).all<{ r2_key: string }>();
        await Promise.all(images.results.map((img) => env.R2.delete(img.r2_key)));
      }
    }
  }

  // Also clean up shares that exceeded max_hits
  const maxHitShares = await env.DB.prepare(
    "SELECT id, type FROM shares WHERE max_hits IS NOT NULL AND hits >= max_hits"
  ).all<{ id: string; type: string }>();

  const allIds = [...expired.results, ...maxHitShares.results].map((s) => s.id);
  const uniqueIds = [...new Set(allIds)];

  // Batch delete
  if (uniqueIds.length > 0) {
    const placeholders = uniqueIds.map(() => "?").join(",");
    await env.DB.prepare(`DELETE FROM shares WHERE id IN (${placeholders})`)
      .bind(...uniqueIds)
      .run();
  }
}
