import { Hono } from "hono";
import type { Env } from "../types";
import { json, error } from "../lib/response";
import { requireAuth } from "../middleware/auth";

type UploadApp = { Bindings: Env; Variables: { userId: string } };

const upload = new Hono<UploadApp>();

upload.use("/*", requireAuth);

// Direct upload to R2 (for files under ~1GB)
upload.post("/presign", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    filename: string;
    contentType: string;
    size: number;
  }>();

  if (!body.filename || !body.contentType) {
    return error("Filename and content type are required", "VALIDATION_ERROR");
  }

  if (body.size > 1024 * 1024 * 1024) {
    return error("File too large (max 1GB).", "FILE_TOO_LARGE", 413);
  }

  const r2Key = `${userId}/${crypto.randomUUID()}/${body.filename}`;
  const uploadId = crypto.randomUUID();

  // Store upload metadata temporarily
  await c.env.KV.put(
    `upload:${uploadId}`,
    JSON.stringify({ userId, r2Key, filename: body.filename, contentType: body.contentType, size: body.size }),
    { expirationTtl: 3600 } // 1 hour
  );

  return json({ uploadId, r2Key });
});

// Direct PUT to worker for R2 upload (since we can't do presigned URLs easily in Workers)
upload.put("/file/:uploadId", async (c) => {
  const userId = c.get("userId");
  const uploadId = c.req.param("uploadId");

  const uploadData = await c.env.KV.get(`upload:${uploadId}`);
  if (!uploadData) {
    return error("Upload session expired", "UPLOAD_EXPIRED");
  }

  const { userId: expectedUserId, r2Key, contentType } = JSON.parse(uploadData);
  if (expectedUserId !== userId) {
    return error("Unauthorized upload", "UNAUTHORIZED", 403);
  }

  const body = c.req.raw.body;
  if (!body) {
    return error("No request body", "VALIDATION_ERROR");
  }

  await c.env.R2.put(r2Key, body, {
    httpMetadata: { contentType },
  });

  await c.env.KV.delete(`upload:${uploadId}`);

  const { size } = JSON.parse(uploadData);
  return json({ r2Key, size });
});

// Multipart upload - init
upload.post("/presign-multipart", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    filename: string;
    contentType: string;
  }>();

  const r2Key = `${userId}/${crypto.randomUUID()}/${body.filename}`;

  const multipartUpload = await c.env.R2.createMultipartUpload(r2Key, {
    httpMetadata: { contentType: body.contentType },
  });

  await c.env.KV.put(
    `multipart:${multipartUpload.uploadId}`,
    JSON.stringify({ userId, r2Key }),
    { expirationTtl: 86400 } // 24 hours
  );

  return json({
    uploadId: multipartUpload.uploadId,
    r2Key,
  });
});

// Multipart upload - upload a single part
upload.put("/multipart-part/:uploadId/:partNumber", async (c) => {
  const userId = c.get("userId");
  const uploadId = c.req.param("uploadId");
  const partNumber = parseInt(c.req.param("partNumber"), 10);

  const uploadData = await c.env.KV.get(`multipart:${uploadId}`);
  if (!uploadData) {
    return error("Multipart upload session not found", "UPLOAD_NOT_FOUND");
  }

  const { userId: expectedUserId, r2Key } = JSON.parse(uploadData);
  if (expectedUserId !== userId) {
    return error("Unauthorized", "UNAUTHORIZED", 403);
  }

  const body = c.req.raw.body;
  if (!body) {
    return error("No request body", "VALIDATION_ERROR");
  }

  const multipartUpload = c.env.R2.resumeMultipartUpload(r2Key, uploadId);
  const part = await multipartUpload.uploadPart(partNumber, body);

  return json({ partNumber: part.partNumber, etag: part.etag });
});

// Multipart upload - complete
upload.post("/complete-multipart", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    uploadId: string;
    r2Key: string;
    parts: Array<{ partNumber: number; etag: string }>;
  }>();

  const uploadData = await c.env.KV.get(`multipart:${body.uploadId}`);
  if (!uploadData) {
    return error("Multipart upload session not found", "UPLOAD_NOT_FOUND");
  }

  const { userId: expectedUserId } = JSON.parse(uploadData);
  if (expectedUserId !== userId) {
    return error("Unauthorized", "UNAUTHORIZED", 403);
  }

  const multipartUpload = c.env.R2.resumeMultipartUpload(body.r2Key, body.uploadId);
  await multipartUpload.complete(body.parts);

  await c.env.KV.delete(`multipart:${body.uploadId}`);

  return json({ completed: true, r2Key: body.r2Key });
});

export default upload;
