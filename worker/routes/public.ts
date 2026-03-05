import { Hono } from "hono";
import type { Env, Share } from "../types";
import type { D1Database } from "@cloudflare/workers-types";
import { json, error } from "../lib/response";
import { rateLimit } from "../middleware/ratelimit";
import { getShareTypeData } from "./shares";

type PublicApp = { Bindings: Env };

const publicRoutes = new Hono<PublicApp>();

publicRoutes.use("/*", rateLimit(120, 60));

// Helper to validate share and check expiry/hits
async function resolveShare(db: D1Database, slug: string): Promise<Share | null> {
  const share = await db.prepare("SELECT * FROM shares WHERE slug = ?").bind(slug).first<Share>();
  if (!share) return null;
  if (share.expires_at && new Date(share.expires_at) < new Date()) return null;
  if (share.max_hits && share.hits >= share.max_hits) return null;
  return share;
}

// JSON API for the SPA to fetch share data (mounted at /s/data/:slug via parent)
publicRoutes.get("/data/:slug", async (c) => {
  const slug = c.req.param("slug");

  const share = await c.env.DB.prepare("SELECT * FROM shares WHERE slug = ?").bind(slug).first<Share>();
  if (!share) return error("Share not found", "NOT_FOUND", 404);
  if (share.expires_at && new Date(share.expires_at) < new Date()) return error("This share has expired", "EXPIRED", 410);
  if (share.max_hits && share.hits >= share.max_hits) return error("This share has reached its view limit", "MAX_HITS", 410);

  // Increment hits
  c.executionCtx.waitUntil(
    c.env.DB.prepare("UPDATE shares SET hits = hits + 1 WHERE id = ?").bind(share.id).run()
  );

  if (share.type === "link") {
    const linkData = await c.env.DB.prepare(
      "SELECT url FROM link_shares WHERE share_id = ?"
    ).bind(share.id).first<{ url: string }>();
    return json({
      id: share.id, slug: share.slug, type: share.type, title: share.title,
      encrypted: !!share.encrypted, hits: share.hits + 1, created_at: share.created_at,
      link: linkData,
    });
  }

  const typeData = await getShareTypeData(c.env.DB, share);
  return json({
    id: share.id, slug: share.slug, type: share.type, title: share.title,
    encrypted: !!share.encrypted, hits: share.hits + 1, created_at: share.created_at,
    ...typeData,
  });
});

// Direct /s/:slug — only handle link redirects, everything else → SPA
publicRoutes.get("/:slug", async (c) => {
  const slug = c.req.param("slug");

  const share = await resolveShare(c.env.DB, slug);

  // Not a valid link → serve SPA and let it handle errors/rendering
  if (!share || share.type !== "link") {
    return c.env.ASSETS.fetch(c.req.raw);
  }

  // Increment hits for link redirect
  c.executionCtx.waitUntil(
    c.env.DB.prepare("UPDATE shares SET hits = hits + 1 WHERE id = ?").bind(share.id).run()
  );

  const linkData = await c.env.DB.prepare(
    "SELECT url FROM link_shares WHERE share_id = ?"
  ).bind(share.id).first<{ url: string }>();

  if (linkData) {
    return c.redirect(linkData.url, 302);
  }

  return c.env.ASSETS.fetch(c.req.raw);
});

// Raw content (text/plain)
publicRoutes.get("/:slug/raw", async (c) => {
  const slug = c.req.param("slug");

  const share = await c.env.DB.prepare(
    "SELECT * FROM shares WHERE slug = ?"
  ).bind(slug).first<Share>();

  if (!share) return error("Share not found", "NOT_FOUND", 404);
  if (share.expires_at && new Date(share.expires_at) < new Date()) return error("Expired", "EXPIRED", 410);
  if (share.max_hits && share.hits >= share.max_hits) return error("Max hits reached", "MAX_HITS", 410);

  if (share.type === "markdown") {
    const md = await c.env.DB.prepare("SELECT content FROM markdown_shares WHERE share_id = ?")
      .bind(share.id).first<{ content: string }>();
    return new Response(md?.content || "", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  if (share.type === "code") {
    const code = await c.env.DB.prepare("SELECT content FROM code_shares WHERE share_id = ?")
      .bind(share.id).first<{ content: string }>();
    return new Response(code?.content || "", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  return error("Raw view not supported for this share type", "UNSUPPORTED", 400);
});

// File download
publicRoutes.get("/:slug/download", async (c) => {
  const slug = c.req.param("slug");

  const share = await c.env.DB.prepare(
    "SELECT * FROM shares WHERE slug = ?"
  ).bind(slug).first<Share>();

  if (!share) return error("Share not found", "NOT_FOUND", 404);
  if (share.expires_at && new Date(share.expires_at) < new Date()) return error("Expired", "EXPIRED", 410);
  if (share.max_hits && share.hits >= share.max_hits) return error("Max hits reached", "MAX_HITS", 410);

  if (share.type !== "file") {
    return error("Download not supported for this share type", "UNSUPPORTED", 400);
  }

  const fileData = await c.env.DB.prepare(
    "SELECT filename, content_type, r2_key FROM file_shares WHERE share_id = ?"
  ).bind(share.id).first<{ filename: string; content_type: string; r2_key: string }>();

  if (!fileData) return error("File data not found", "NOT_FOUND", 404);

  const object = await c.env.R2.get(fileData.r2_key);
  if (!object) return error("File not found in storage", "NOT_FOUND", 404);

  return new Response(object.body, {
    headers: {
      "Content-Type": fileData.content_type,
      "Content-Disposition": `attachment; filename="${fileData.filename.replace(/["\\]/g, '_')}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
});

// Gallery image
publicRoutes.get("/:slug/image/:imageId", async (c) => {
  const slug = c.req.param("slug");
  const imageId = c.req.param("imageId");

  const share = await c.env.DB.prepare(
    "SELECT * FROM shares WHERE slug = ?"
  ).bind(slug).first<Share>();

  if (!share) return error("Share not found", "NOT_FOUND", 404);
  if (share.type !== "gallery") return error("Not a gallery", "UNSUPPORTED", 400);
  if (share.expires_at && new Date(share.expires_at) < new Date()) return error("Expired", "EXPIRED", 410);

  const image = await c.env.DB.prepare(
    "SELECT gi.filename, gi.content_type, gi.r2_key FROM gallery_images gi JOIN gallery_shares gs ON gi.gallery_id = gs.id WHERE gi.id = ? AND gs.share_id = ?"
  ).bind(imageId, share.id).first<{ filename: string; content_type: string; r2_key: string }>();

  if (!image) return error("Image not found", "NOT_FOUND", 404);

  const object = await c.env.R2.get(image.r2_key);
  if (!object) return error("Image not found in storage", "NOT_FOUND", 404);

  return new Response(object.body, {
    headers: {
      "Content-Type": image.content_type,
      "Cache-Control": "public, max-age=86400",
    },
  });
});

export default publicRoutes;
