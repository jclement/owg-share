import { Hono } from "hono";
import type { Env, Share, ShareType } from "../types";
import { json, error, paginated } from "../lib/response";
import { requireAuth } from "../middleware/auth";
import { generateSlug, validateCustomSlug, type SlugType } from "../lib/slug";

type ShareApp = { Bindings: Env; Variables: { userId: string } };

const shares = new Hono<ShareApp>();

shares.use("/*", requireAuth);

// List all shares
shares.get("/", async (c) => {
  const userId = c.get("userId");
  const url = new URL(c.req.url);
  const type = url.searchParams.get("type") as ShareType | null;
  const page = parseInt(url.searchParams.get("page") || "1");
  const perPage = Math.min(parseInt(url.searchParams.get("per_page") || "20"), 100);
  const search = url.searchParams.get("search");
  const offset = (page - 1) * perPage;

  let query = "SELECT * FROM shares WHERE user_id = ?";
  let countQuery = "SELECT COUNT(*) as count FROM shares WHERE user_id = ?";
  const params: (string | number)[] = [userId];
  const countParams: (string | number)[] = [userId];

  if (type) {
    query += " AND type = ?";
    countQuery += " AND type = ?";
    params.push(type);
    countParams.push(type);
  }

  if (search) {
    query += " AND (title LIKE ? OR slug LIKE ?)";
    countQuery += " AND (title LIKE ? OR slug LIKE ?)";
    const searchParam = `%${search}%`;
    params.push(searchParam, searchParam);
    countParams.push(searchParam, searchParam);
  }

  query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(perPage, offset);

  const [results, total] = await Promise.all([
    c.env.DB.prepare(query).bind(...params).all<Share>(),
    c.env.DB.prepare(countQuery).bind(...countParams).first<{ count: number }>(),
  ]);

  return paginated(results.results, total?.count || 0, page, perPage);
});

// Get share by ID (with type-specific data)
shares.get("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const share = await c.env.DB.prepare(
    "SELECT * FROM shares WHERE id = ? AND user_id = ?"
  ).bind(id, userId).first<Share>();

  if (!share) return error("Share not found", "NOT_FOUND", 404);

  const typeData = await getShareTypeData(c.env.DB, share);
  return json({ ...share, ...typeData });
});

// Delete share
shares.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const share = await c.env.DB.prepare(
    "SELECT * FROM shares WHERE id = ? AND user_id = ?"
  ).bind(id, userId).first<Share>();

  if (!share) return error("Share not found", "NOT_FOUND", 404);

  // Delete R2 objects if file/gallery
  if (share.type === "file") {
    const fileShare = await c.env.DB.prepare(
      "SELECT r2_key FROM file_shares WHERE share_id = ?"
    ).bind(id).first<{ r2_key: string }>();
    if (fileShare) await c.env.R2.delete(fileShare.r2_key);
  } else if (share.type === "gallery") {
    const galleryShare = await c.env.DB.prepare(
      "SELECT id FROM gallery_shares WHERE share_id = ?"
    ).bind(id).first<{ id: string }>();
    if (galleryShare) {
      const images = await c.env.DB.prepare(
        "SELECT r2_key FROM gallery_images WHERE gallery_id = ?"
      ).bind(galleryShare.id).all<{ r2_key: string }>();
      await Promise.all(images.results.map((img) => c.env.R2.delete(img.r2_key)));
    }
  }

  await c.env.DB.prepare("DELETE FROM shares WHERE id = ?").bind(id).run();
  return json({ deleted: true });
});

// Get share stats
shares.get("/stats/summary", async (c) => {
  const userId = c.get("userId");

  const [total, byType, totalHits] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) as count FROM shares WHERE user_id = ?")
      .bind(userId).first<{ count: number }>(),
    c.env.DB.prepare(
      "SELECT type, COUNT(*) as count FROM shares WHERE user_id = ? GROUP BY type"
    ).bind(userId).all<{ type: string; count: number }>(),
    c.env.DB.prepare("SELECT SUM(hits) as total FROM shares WHERE user_id = ?")
      .bind(userId).first<{ total: number }>(),
  ]);

  return json({
    total: total?.count || 0,
    totalHits: totalHits?.total || 0,
    byType: Object.fromEntries(byType.results.map((r) => [r.type, r.count])),
  });
});

// Create link share
shares.post("/links", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    url: string;
    title?: string;
    comment?: string;
    slug_type?: SlugType;
    custom_slug?: string;
    expires_at?: string;
    max_hits?: number;
  }>();

  if (!body.url) return error("URL is required", "VALIDATION_ERROR");

  try { new URL(body.url); } catch { return error("Invalid URL", "VALIDATION_ERROR"); }

  const slug = await resolveSlug(c.env.DB, body.slug_type || "short", body.custom_slug);
  if (typeof slug !== "string") return slug;

  const shareId = crypto.randomUUID();
  const linkId = crypto.randomUUID();

  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO shares (id, user_id, slug, type, title, comment, expires_at, max_hits) VALUES (?, ?, ?, 'link', ?, ?, ?, ?)"
    ).bind(shareId, userId, slug, body.title || null, body.comment || null, body.expires_at || null, body.max_hits || null),
    c.env.DB.prepare(
      "INSERT INTO link_shares (id, share_id, url) VALUES (?, ?, ?)"
    ).bind(linkId, shareId, body.url),
  ]);

  return json({ id: shareId, slug, type: "link", url: body.url }, 201);
});

// Update link share
shares.put("/links/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json<{ url?: string; title?: string; comment?: string; expires_at?: string; max_hits?: number }>();

  const share = await c.env.DB.prepare(
    "SELECT id FROM shares WHERE id = ? AND user_id = ? AND type = 'link'"
  ).bind(id, userId).first();
  if (!share) return error("Link share not found", "NOT_FOUND", 404);

  if (body.url) {
    try { new URL(body.url); } catch { return error("Invalid URL", "VALIDATION_ERROR"); }
  }

  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  if (body.title !== undefined) { updates.push("title = ?"); params.push(body.title || null); }
  if (body.comment !== undefined) { updates.push("comment = ?"); params.push(body.comment || null); }
  if (body.expires_at !== undefined) { updates.push("expires_at = ?"); params.push(body.expires_at || null); }
  if (body.max_hits !== undefined) { updates.push("max_hits = ?"); params.push(body.max_hits || null); }

  const statements = [];
  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    statements.push(c.env.DB.prepare(`UPDATE shares SET ${updates.join(", ")} WHERE id = ?`).bind(...params, id));
  }
  if (body.url) {
    statements.push(c.env.DB.prepare("UPDATE link_shares SET url = ? WHERE share_id = ?").bind(body.url, id));
  }

  if (statements.length > 0) await c.env.DB.batch(statements);
  return json({ updated: true });
});

// Create markdown share
shares.post("/markdown", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    content: string;
    title?: string;
    comment?: string;
    encrypted?: boolean;
    slug_type?: SlugType;
    custom_slug?: string;
    expires_at?: string;
    max_hits?: number;
  }>();

  if (!body.content) return error("Content is required", "VALIDATION_ERROR");

  const slugType = body.encrypted ? "encrypted" : (body.slug_type || "long");
  const slug = await resolveSlug(c.env.DB, slugType, body.custom_slug);
  if (typeof slug !== "string") return slug;

  const shareId = crypto.randomUUID();
  const mdId = crypto.randomUUID();

  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO shares (id, user_id, slug, type, title, comment, encrypted, expires_at, max_hits) VALUES (?, ?, ?, 'markdown', ?, ?, ?, ?, ?)"
    ).bind(shareId, userId, slug, body.title || null, body.comment || null, body.encrypted ? 1 : 0, body.expires_at || null, body.max_hits || null),
    c.env.DB.prepare(
      "INSERT INTO markdown_shares (id, share_id, content) VALUES (?, ?, ?)"
    ).bind(mdId, shareId, body.content),
  ]);

  return json({ id: shareId, slug, type: "markdown", encrypted: !!body.encrypted }, 201);
});

// Update markdown share
shares.put("/markdown/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json<{ content?: string; title?: string; comment?: string; expires_at?: string; max_hits?: number }>();

  const share = await c.env.DB.prepare(
    "SELECT id FROM shares WHERE id = ? AND user_id = ? AND type = 'markdown'"
  ).bind(id, userId).first();
  if (!share) return error("Markdown share not found", "NOT_FOUND", 404);

  const statements = [];

  const updates: string[] = [];
  const params: (string | number | null)[] = [];
  if (body.title !== undefined) { updates.push("title = ?"); params.push(body.title || null); }
  if (body.comment !== undefined) { updates.push("comment = ?"); params.push(body.comment || null); }
  if (body.expires_at !== undefined) { updates.push("expires_at = ?"); params.push(body.expires_at || null); }
  if (body.max_hits !== undefined) { updates.push("max_hits = ?"); params.push(body.max_hits || null); }

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    statements.push(c.env.DB.prepare(`UPDATE shares SET ${updates.join(", ")} WHERE id = ?`).bind(...params, id));
  }
  if (body.content) {
    statements.push(c.env.DB.prepare("UPDATE markdown_shares SET content = ? WHERE share_id = ?").bind(body.content, id));
  }

  if (statements.length > 0) await c.env.DB.batch(statements);
  return json({ updated: true });
});

// Create code share
shares.post("/code", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    content: string;
    language?: string;
    filename?: string;
    title?: string;
    comment?: string;
    encrypted?: boolean;
    slug_type?: SlugType;
    custom_slug?: string;
    expires_at?: string;
    max_hits?: number;
  }>();

  if (!body.content) return error("Content is required", "VALIDATION_ERROR");

  const slugType = body.encrypted ? "encrypted" : (body.slug_type || "long");
  const slug = await resolveSlug(c.env.DB, slugType, body.custom_slug);
  if (typeof slug !== "string") return slug;

  const shareId = crypto.randomUUID();
  const codeId = crypto.randomUUID();

  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO shares (id, user_id, slug, type, title, comment, encrypted, expires_at, max_hits) VALUES (?, ?, ?, 'code', ?, ?, ?, ?, ?)"
    ).bind(shareId, userId, slug, body.title || null, body.comment || null, body.encrypted ? 1 : 0, body.expires_at || null, body.max_hits || null),
    c.env.DB.prepare(
      "INSERT INTO code_shares (id, share_id, content, language, filename) VALUES (?, ?, ?, ?, ?)"
    ).bind(codeId, shareId, body.content, body.language || null, body.filename || null),
  ]);

  return json({ id: shareId, slug, type: "code", encrypted: !!body.encrypted }, 201);
});

// Update code share
shares.put("/code/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json<{ content?: string; language?: string; filename?: string; title?: string; comment?: string; expires_at?: string; max_hits?: number }>();

  const share = await c.env.DB.prepare(
    "SELECT id FROM shares WHERE id = ? AND user_id = ? AND type = 'code'"
  ).bind(id, userId).first();
  if (!share) return error("Code share not found", "NOT_FOUND", 404);

  const statements = [];

  const updates: string[] = [];
  const params: (string | number | null)[] = [];
  if (body.title !== undefined) { updates.push("title = ?"); params.push(body.title || null); }
  if (body.comment !== undefined) { updates.push("comment = ?"); params.push(body.comment || null); }
  if (body.expires_at !== undefined) { updates.push("expires_at = ?"); params.push(body.expires_at || null); }
  if (body.max_hits !== undefined) { updates.push("max_hits = ?"); params.push(body.max_hits || null); }
  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    statements.push(c.env.DB.prepare(`UPDATE shares SET ${updates.join(", ")} WHERE id = ?`).bind(...params, id));
  }

  const codeUpdates: string[] = [];
  const codeParams: (string | null)[] = [];
  if (body.content !== undefined) { codeUpdates.push("content = ?"); codeParams.push(body.content); }
  if (body.language !== undefined) { codeUpdates.push("language = ?"); codeParams.push(body.language || null); }
  if (body.filename !== undefined) { codeUpdates.push("filename = ?"); codeParams.push(body.filename || null); }
  if (codeUpdates.length > 0) {
    statements.push(c.env.DB.prepare(`UPDATE code_shares SET ${codeUpdates.join(", ")} WHERE share_id = ?`).bind(...codeParams, id));
  }

  if (statements.length > 0) await c.env.DB.batch(statements);
  return json({ updated: true });
});

// Create file share
shares.post("/files", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    filename: string;
    content_type: string;
    size: number;
    r2_key: string;
    title?: string;
    comment?: string;
    encrypted?: boolean;
    slug_type?: SlugType;
    custom_slug?: string;
    expires_at?: string;
    max_hits?: number;
  }>();

  if (!body.filename || !body.content_type || !body.r2_key) {
    return error("Missing required fields", "VALIDATION_ERROR");
  }

  if (!body.r2_key.startsWith(`${userId}/`)) {
    return error("Invalid file reference", "UNAUTHORIZED", 403);
  }

  const slugType = body.encrypted ? "encrypted" : (body.slug_type || "long");
  const slug = await resolveSlug(c.env.DB, slugType, body.custom_slug);
  if (typeof slug !== "string") return slug;

  const shareId = crypto.randomUUID();
  const fileId = crypto.randomUUID();

  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO shares (id, user_id, slug, type, title, comment, encrypted, expires_at, max_hits) VALUES (?, ?, ?, 'file', ?, ?, ?, ?, ?)"
    ).bind(shareId, userId, slug, body.title || null, body.comment || null, body.encrypted ? 1 : 0, body.expires_at || null, body.max_hits || null),
    c.env.DB.prepare(
      "INSERT INTO file_shares (id, share_id, filename, content_type, size, r2_key) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(fileId, shareId, body.filename, body.content_type, body.size, body.r2_key),
  ]);

  return json({ id: shareId, slug, type: "file", encrypted: !!body.encrypted }, 201);
});

// Update file share metadata
shares.put("/files/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json<{ title?: string; comment?: string; expires_at?: string; max_hits?: number }>();

  const share = await c.env.DB.prepare(
    "SELECT id FROM shares WHERE id = ? AND user_id = ? AND type = 'file'"
  ).bind(id, userId).first();
  if (!share) return error("File share not found", "NOT_FOUND", 404);

  const updates: string[] = [];
  const params: (string | number | null)[] = [];
  if (body.title !== undefined) { updates.push("title = ?"); params.push(body.title || null); }
  if (body.comment !== undefined) { updates.push("comment = ?"); params.push(body.comment || null); }
  if (body.expires_at !== undefined) { updates.push("expires_at = ?"); params.push(body.expires_at || null); }
  if (body.max_hits !== undefined) { updates.push("max_hits = ?"); params.push(body.max_hits || null); }

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    await c.env.DB.prepare(`UPDATE shares SET ${updates.join(", ")} WHERE id = ?`).bind(...params, id).run();
  }

  return json({ updated: true });
});

// Create gallery share
shares.post("/galleries", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    title?: string;
    comment?: string;
    encrypted?: boolean;
    slug_type?: SlugType;
    custom_slug?: string;
    expires_at?: string;
    max_hits?: number;
    images?: Array<{ filename: string; content_type: string; size: number; r2_key: string; caption?: string }>;
  }>();

  if (body.images?.some(img => !img.r2_key.startsWith(`${userId}/`))) {
    return error("Invalid file reference", "UNAUTHORIZED", 403);
  }

  const slugType = body.encrypted ? "encrypted" : (body.slug_type || "long");
  const slug = await resolveSlug(c.env.DB, slugType, body.custom_slug);
  if (typeof slug !== "string") return slug;

  const shareId = crypto.randomUUID();
  const galleryId = crypto.randomUUID();

  const statements = [
    c.env.DB.prepare(
      "INSERT INTO shares (id, user_id, slug, type, title, comment, encrypted, expires_at, max_hits) VALUES (?, ?, ?, 'gallery', ?, ?, ?, ?, ?)"
    ).bind(shareId, userId, slug, body.title || null, body.comment || null, body.encrypted ? 1 : 0, body.expires_at || null, body.max_hits || null),
    c.env.DB.prepare(
      "INSERT INTO gallery_shares (id, share_id) VALUES (?, ?)"
    ).bind(galleryId, shareId),
  ];

  if (body.images) {
    for (let i = 0; i < body.images.length; i++) {
      const img = body.images[i];
      statements.push(
        c.env.DB.prepare(
          "INSERT INTO gallery_images (id, gallery_id, filename, content_type, size, r2_key, sort_order, caption) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(crypto.randomUUID(), galleryId, img.filename, img.content_type, img.size, img.r2_key, i, img.caption || null)
      );
    }
  }

  await c.env.DB.batch(statements);
  return json({ id: shareId, galleryId, slug, type: "gallery", encrypted: !!body.encrypted }, 201);
});

// Update gallery
shares.put("/galleries/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json<{ title?: string; comment?: string; expires_at?: string; max_hits?: number }>();

  const share = await c.env.DB.prepare(
    "SELECT id FROM shares WHERE id = ? AND user_id = ? AND type = 'gallery'"
  ).bind(id, userId).first();
  if (!share) return error("Gallery not found", "NOT_FOUND", 404);

  const updates: string[] = [];
  const params: (string | number | null)[] = [];
  if (body.title !== undefined) { updates.push("title = ?"); params.push(body.title || null); }
  if (body.comment !== undefined) { updates.push("comment = ?"); params.push(body.comment || null); }
  if (body.expires_at !== undefined) { updates.push("expires_at = ?"); params.push(body.expires_at || null); }
  if (body.max_hits !== undefined) { updates.push("max_hits = ?"); params.push(body.max_hits || null); }
  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    await c.env.DB.prepare(`UPDATE shares SET ${updates.join(", ")} WHERE id = ?`).bind(...params, id).run();
  }

  return json({ updated: true });
});

// Add images to gallery
shares.post("/galleries/:id/images", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json<{
    images: Array<{ filename: string; content_type: string; size: number; r2_key: string; caption?: string }>;
  }>();

  if (body.images.some(img => !img.r2_key.startsWith(`${userId}/`))) {
    return error("Invalid file reference", "UNAUTHORIZED", 403);
  }

  const share = await c.env.DB.prepare(
    "SELECT id FROM shares WHERE id = ? AND user_id = ? AND type = 'gallery'"
  ).bind(id, userId).first();
  if (!share) return error("Gallery not found", "NOT_FOUND", 404);

  const gallery = await c.env.DB.prepare(
    "SELECT id FROM gallery_shares WHERE share_id = ?"
  ).bind(id).first<{ id: string }>();
  if (!gallery) return error("Gallery data not found", "NOT_FOUND", 404);

  // Get current max sort order
  const maxOrder = await c.env.DB.prepare(
    "SELECT MAX(sort_order) as max_order FROM gallery_images WHERE gallery_id = ?"
  ).bind(gallery.id).first<{ max_order: number | null }>();

  const startOrder = (maxOrder?.max_order ?? -1) + 1;
  const imageIds: string[] = [];

  const statements = body.images.map((img, i) => {
    const imgId = crypto.randomUUID();
    imageIds.push(imgId);
    return c.env.DB.prepare(
      "INSERT INTO gallery_images (id, gallery_id, filename, content_type, size, r2_key, sort_order, caption) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(imgId, gallery.id, img.filename, img.content_type, img.size, img.r2_key, startOrder + i, img.caption || null);
  });

  await c.env.DB.batch(statements);
  return json({ imageIds }, 201);
});

// Update gallery image
shares.put("/galleries/:id/images/:imgId", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const imgId = c.req.param("imgId");
  const body = await c.req.json<{ caption?: string }>();

  const share = await c.env.DB.prepare(
    "SELECT id FROM shares WHERE id = ? AND user_id = ? AND type = 'gallery'"
  ).bind(id, userId).first();
  if (!share) return error("Gallery not found", "NOT_FOUND", 404);

  if (body.caption !== undefined) {
    await c.env.DB.prepare(
      "UPDATE gallery_images SET caption = ? WHERE id = ? AND gallery_id IN (SELECT id FROM gallery_shares WHERE share_id = ?)"
    ).bind(body.caption || null, imgId, id).run();
  }

  return json({ updated: true });
});

// Delete gallery image
shares.delete("/galleries/:id/images/:imgId", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const imgId = c.req.param("imgId");

  const share = await c.env.DB.prepare(
    "SELECT id FROM shares WHERE id = ? AND user_id = ? AND type = 'gallery'"
  ).bind(id, userId).first();
  if (!share) return error("Gallery not found", "NOT_FOUND", 404);

  const image = await c.env.DB.prepare(
    "SELECT gi.r2_key FROM gallery_images gi JOIN gallery_shares gs ON gi.gallery_id = gs.id WHERE gi.id = ? AND gs.share_id = ?"
  ).bind(imgId, id).first<{ r2_key: string }>();

  if (image) {
    await c.env.R2.delete(image.r2_key);
    await c.env.DB.prepare("DELETE FROM gallery_images WHERE id = ?").bind(imgId).run();
  }

  return json({ deleted: true });
});

// Reorder gallery images
shares.post("/galleries/:id/reorder", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json<{ imageIds: string[] }>();

  const share = await c.env.DB.prepare(
    "SELECT id FROM shares WHERE id = ? AND user_id = ? AND type = 'gallery'"
  ).bind(id, userId).first();
  if (!share) return error("Gallery not found", "NOT_FOUND", 404);

  const statements = body.imageIds.map((imgId, i) =>
    c.env.DB.prepare(
      "UPDATE gallery_images SET sort_order = ? WHERE id = ? AND gallery_id IN (SELECT id FROM gallery_shares WHERE share_id = ?)"
    ).bind(i, imgId, id)
  );

  await c.env.DB.batch(statements);
  return json({ reordered: true });
});

// Helper: resolve slug
async function resolveSlug(db: D1Database, slugType: SlugType, customSlug?: string): Promise<string | Response> {
  if (slugType === "custom") {
    if (!customSlug) return error("Custom slug is required", "VALIDATION_ERROR");
    const validationError = validateCustomSlug(customSlug);
    if (validationError) return error(validationError, "VALIDATION_ERROR");

    const existing = await db.prepare("SELECT id FROM shares WHERE slug = ?").bind(customSlug).first();
    if (existing) return error("Slug already in use", "SLUG_TAKEN", 409);
    return customSlug;
  }

  // Generate random slug with collision retry
  for (let i = 0; i < 5; i++) {
    const slug = generateSlug(slugType);
    const existing = await db.prepare("SELECT id FROM shares WHERE slug = ?").bind(slug).first();
    if (!existing) return slug;
  }

  return error("Failed to generate unique slug", "SLUG_GENERATION_FAILED", 500);
}

// Helper: get type-specific data for a share
async function getShareTypeData(db: D1Database, share: Share) {
  switch (share.type) {
    case "link":
      return { link: await db.prepare("SELECT url FROM link_shares WHERE share_id = ?").bind(share.id).first() };
    case "markdown":
      return { markdown: await db.prepare("SELECT content FROM markdown_shares WHERE share_id = ?").bind(share.id).first() };
    case "code":
      return { code: await db.prepare("SELECT content, language, filename FROM code_shares WHERE share_id = ?").bind(share.id).first() };
    case "file":
      return { file: await db.prepare("SELECT filename, content_type, size, r2_key FROM file_shares WHERE share_id = ?").bind(share.id).first() };
    case "gallery": {
      const gallery = await db.prepare("SELECT id FROM gallery_shares WHERE share_id = ?").bind(share.id).first<{ id: string }>();
      if (!gallery) return { gallery: null, images: [] };
      const images = await db.prepare(
        "SELECT id, filename, content_type, size, r2_key, sort_order, caption FROM gallery_images WHERE gallery_id = ? ORDER BY sort_order"
      ).bind(gallery.id).all();
      return { gallery, images: images.results };
    }
    default:
      return {};
  }
}

export { getShareTypeData };
export default shares;
