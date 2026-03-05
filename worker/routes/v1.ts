import { Hono } from "hono";
import type { Env } from "../types";
import { json, error } from "../lib/response";
import { requireApiKey } from "../middleware/apikey";
import { generateSlug, type SlugType } from "../lib/slug";
import { rateLimit } from "../middleware/ratelimit";

type V1App = { Bindings: Env; Variables: { userId: string } };

const v1 = new Hono<V1App>();

v1.use("/*", rateLimit(30, 60));
v1.use("/*", requireApiKey);

// Create link via API key
v1.post("/links", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    url: string;
    title?: string;
    slug_type?: SlugType;
    custom_slug?: string;
  }>();

  if (!body.url) return error("URL is required", "VALIDATION_ERROR");
  try { new URL(body.url); } catch { return error("Invalid URL", "VALIDATION_ERROR"); }

  const slug = generateSlug(body.slug_type || "short");
  const shareId = crypto.randomUUID();

  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO shares (id, user_id, slug, type, title) VALUES (?, ?, ?, 'link', ?)"
    ).bind(shareId, userId, slug, body.title || null),
    c.env.DB.prepare(
      "INSERT INTO link_shares (id, share_id, url) VALUES (?, ?, ?)"
    ).bind(crypto.randomUUID(), shareId, body.url),
  ]);

  return json({ id: shareId, slug, url: `/s/${slug}` }, 201);
});

// Create markdown via API key
v1.post("/markdown", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    content: string;
    title?: string;
  }>();

  if (!body.content) return error("Content is required", "VALIDATION_ERROR");

  const slug = generateSlug("long");
  const shareId = crypto.randomUUID();

  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO shares (id, user_id, slug, type, title) VALUES (?, ?, ?, 'markdown', ?)"
    ).bind(shareId, userId, slug, body.title || null),
    c.env.DB.prepare(
      "INSERT INTO markdown_shares (id, share_id, content) VALUES (?, ?, ?)"
    ).bind(crypto.randomUUID(), shareId, body.content),
  ]);

  return json({ id: shareId, slug, url: `/s/${slug}` }, 201);
});

// Create code via API key
v1.post("/code", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    content: string;
    language?: string;
    filename?: string;
    title?: string;
  }>();

  if (!body.content) return error("Content is required", "VALIDATION_ERROR");

  const slug = generateSlug("long");
  const shareId = crypto.randomUUID();

  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO shares (id, user_id, slug, type, title) VALUES (?, ?, ?, 'code', ?)"
    ).bind(shareId, userId, slug, body.title || null),
    c.env.DB.prepare(
      "INSERT INTO code_shares (id, share_id, content, language, filename) VALUES (?, ?, ?, ?, ?)"
    ).bind(crypto.randomUUID(), shareId, body.content, body.language || null, body.filename || null),
  ]);

  return json({ id: shareId, slug, url: `/s/${slug}` }, 201);
});

export default v1;
