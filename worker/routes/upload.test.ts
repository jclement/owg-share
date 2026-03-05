import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";

vi.mock("../middleware/auth", () => ({
  requireAuth: createMiddleware(async (c, next) => {
    c.set("userId", "test-user-123");
    await next();
  }),
}));

import upload from "./upload";

// --- Mocks ---

const mockMultipartUpload = {
  uploadId: "mp-upload-123",
  uploadPart: vi.fn().mockResolvedValue({ partNumber: 1, etag: "etag-1" }),
  complete: vi.fn().mockResolvedValue({}),
};

const mockKV = {
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
};

const mockR2 = {
  put: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
  createMultipartUpload: vi.fn().mockResolvedValue(mockMultipartUpload),
  resumeMultipartUpload: vi.fn().mockReturnValue(mockMultipartUpload),
};

const mockDB = {
  prepare: vi.fn().mockReturnValue({
    bind: vi.fn().mockReturnValue({
      all: vi.fn().mockResolvedValue({ results: [] }),
      first: vi.fn().mockResolvedValue(null),
      run: vi.fn().mockResolvedValue({ meta: { changes: 0 } }),
    }),
  }),
};

function createApp() {
  const app = new Hono();
  app.route("/upload", upload);
  return app;
}

function makeRequest(
  path: string,
  options: RequestInit = {}
): Request {
  return new Request(`http://localhost${path}`, options);
}

// --- Tests ---

describe("Upload routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKV.get.mockResolvedValue(null);
    mockKV.put.mockResolvedValue(undefined);
    mockKV.delete.mockResolvedValue(undefined);
    mockR2.put.mockResolvedValue(undefined);
    mockMultipartUpload.uploadPart.mockResolvedValue({ partNumber: 1, etag: "etag-1" });
    mockMultipartUpload.complete.mockResolvedValue({});
  });

  // =========================================================================
  // POST /presign
  // =========================================================================
  describe("POST /presign", () => {
    it("returns uploadId and r2Key for valid request", async () => {
      const app = createApp();
      const req = makeRequest("/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "photo.jpg",
          contentType: "image/jpeg",
          size: 1024,
        }),
      });

      const res = await app.fetch(req, { KV: mockKV, R2: mockR2, DB: mockDB });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.uploadId).toBeDefined();
      expect(body.data.r2Key).toBeDefined();
      expect(body.data.r2Key).toContain("test-user-123/");
      expect(body.data.r2Key).toContain("photo.jpg");

      // KV should have been called to store the upload session
      expect(mockKV.put).toHaveBeenCalledOnce();
      const kvCallArgs = mockKV.put.mock.calls[0];
      expect(kvCallArgs[0]).toMatch(/^upload:/);
      const storedData = JSON.parse(kvCallArgs[1]);
      expect(storedData.userId).toBe("test-user-123");
      expect(storedData.filename).toBe("photo.jpg");
      expect(kvCallArgs[2]).toEqual({ expirationTtl: 3600 });
    });

    it("returns 400 when filename is missing", async () => {
      const app = createApp();
      const req = makeRequest("/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentType: "image/jpeg",
          size: 1024,
        }),
      });

      const res = await app.fetch(req, { KV: mockKV, R2: mockR2, DB: mockDB });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 413 when file exceeds 1GB", async () => {
      const app = createApp();
      const req = makeRequest("/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "huge.bin",
          contentType: "application/octet-stream",
          size: 1024 * 1024 * 1024 + 1, // 1GB + 1 byte
        }),
      });

      const res = await app.fetch(req, { KV: mockKV, R2: mockR2, DB: mockDB });
      const body = await res.json();

      expect(res.status).toBe(413);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("FILE_TOO_LARGE");
    });
  });

  // =========================================================================
  // PUT /file/:uploadId
  // =========================================================================
  describe("PUT /file/:uploadId", () => {
    it("stores file in R2 and cleans up KV for valid upload", async () => {
      const uploadSession = JSON.stringify({
        userId: "test-user-123",
        r2Key: "test-user-123/abc/file.txt",
        filename: "file.txt",
        contentType: "text/plain",
        size: 42,
      });
      mockKV.get.mockResolvedValue(uploadSession);

      const app = createApp();
      const req = makeRequest("/upload/file/upload-id-999", {
        method: "PUT",
        body: "file content here",
      });

      const res = await app.fetch(req, { KV: mockKV, R2: mockR2, DB: mockDB });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.r2Key).toBe("test-user-123/abc/file.txt");
      expect(body.data.size).toBe(42);

      // R2 should have received the file
      expect(mockR2.put).toHaveBeenCalledOnce();
      expect(mockR2.put.mock.calls[0][0]).toBe("test-user-123/abc/file.txt");

      // KV should have been cleaned up
      expect(mockKV.delete).toHaveBeenCalledWith("upload:upload-id-999");
    });

    it("returns error when upload session is expired/missing", async () => {
      mockKV.get.mockResolvedValue(null);

      const app = createApp();
      const req = makeRequest("/upload/file/nonexistent-id", {
        method: "PUT",
        body: "file content",
      });

      const res = await app.fetch(req, { KV: mockKV, R2: mockR2, DB: mockDB });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("UPLOAD_EXPIRED");
    });

    it("returns 403 when userId does not match", async () => {
      const uploadSession = JSON.stringify({
        userId: "different-user-456",
        r2Key: "different-user-456/abc/file.txt",
        filename: "file.txt",
        contentType: "text/plain",
        size: 42,
      });
      mockKV.get.mockResolvedValue(uploadSession);

      const app = createApp();
      const req = makeRequest("/upload/file/upload-id-999", {
        method: "PUT",
        body: "file content",
      });

      const res = await app.fetch(req, { KV: mockKV, R2: mockR2, DB: mockDB });
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("UNAUTHORIZED");
    });
  });

  // =========================================================================
  // POST /presign-multipart
  // =========================================================================
  describe("POST /presign-multipart", () => {
    it("returns uploadId and r2Key for valid multipart request", async () => {
      const app = createApp();
      const req = makeRequest("/upload/presign-multipart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "large-video.mp4",
          contentType: "video/mp4",
        }),
      });

      const res = await app.fetch(req, { KV: mockKV, R2: mockR2, DB: mockDB });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.uploadId).toBe("mp-upload-123");
      expect(body.data.r2Key).toContain("test-user-123/");
      expect(body.data.r2Key).toContain("large-video.mp4");

      // R2 multipart upload should have been created
      expect(mockR2.createMultipartUpload).toHaveBeenCalledOnce();

      // KV should store the multipart session
      expect(mockKV.put).toHaveBeenCalledOnce();
      const kvCallArgs = mockKV.put.mock.calls[0];
      expect(kvCallArgs[0]).toBe("multipart:mp-upload-123");
      const storedData = JSON.parse(kvCallArgs[1]);
      expect(storedData.userId).toBe("test-user-123");
      expect(kvCallArgs[2]).toEqual({ expirationTtl: 86400 });
    });
  });

  // =========================================================================
  // PUT /multipart-part/:uploadId/:partNumber
  // =========================================================================
  describe("PUT /multipart-part/:uploadId/:partNumber", () => {
    it("uploads part and returns etag for valid request", async () => {
      const uploadSession = JSON.stringify({
        userId: "test-user-123",
        r2Key: "test-user-123/abc/large.mp4",
      });
      mockKV.get.mockResolvedValue(uploadSession);

      const app = createApp();
      const req = makeRequest("/upload/multipart-part/mp-upload-123/1", {
        method: "PUT",
        body: "part-data-chunk",
      });

      const res = await app.fetch(req, { KV: mockKV, R2: mockR2, DB: mockDB });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.partNumber).toBe(1);
      expect(body.data.etag).toBe("etag-1");

      // Should have resumed the multipart upload
      expect(mockR2.resumeMultipartUpload).toHaveBeenCalledWith(
        "test-user-123/abc/large.mp4",
        "mp-upload-123"
      );
      expect(mockMultipartUpload.uploadPart).toHaveBeenCalledOnce();
    });

    it("returns error when multipart upload session is missing", async () => {
      mockKV.get.mockResolvedValue(null);

      const app = createApp();
      const req = makeRequest("/upload/multipart-part/bad-id/1", {
        method: "PUT",
        body: "part-data",
      });

      const res = await app.fetch(req, { KV: mockKV, R2: mockR2, DB: mockDB });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("UPLOAD_NOT_FOUND");
    });

    it("returns 403 when userId does not match", async () => {
      const uploadSession = JSON.stringify({
        userId: "other-user-789",
        r2Key: "other-user-789/abc/large.mp4",
      });
      mockKV.get.mockResolvedValue(uploadSession);

      const app = createApp();
      const req = makeRequest("/upload/multipart-part/mp-upload-123/1", {
        method: "PUT",
        body: "part-data",
      });

      const res = await app.fetch(req, { KV: mockKV, R2: mockR2, DB: mockDB });
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("UNAUTHORIZED");
    });
  });

  // =========================================================================
  // POST /complete-multipart
  // =========================================================================
  describe("POST /complete-multipart", () => {
    it("completes multipart upload and cleans up KV", async () => {
      const uploadSession = JSON.stringify({
        userId: "test-user-123",
        r2Key: "test-user-123/abc/large.mp4",
      });
      mockKV.get.mockResolvedValue(uploadSession);

      const app = createApp();
      const req = makeRequest("/upload/complete-multipart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploadId: "mp-upload-123",
          r2Key: "test-user-123/abc/large.mp4",
          parts: [
            { partNumber: 1, etag: "etag-1" },
            { partNumber: 2, etag: "etag-2" },
          ],
        }),
      });

      const res = await app.fetch(req, { KV: mockKV, R2: mockR2, DB: mockDB });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.completed).toBe(true);
      expect(body.data.r2Key).toBe("test-user-123/abc/large.mp4");

      // Should have resumed and completed the multipart upload
      expect(mockR2.resumeMultipartUpload).toHaveBeenCalledWith(
        "test-user-123/abc/large.mp4",
        "mp-upload-123"
      );
      expect(mockMultipartUpload.complete).toHaveBeenCalledWith([
        { partNumber: 1, etag: "etag-1" },
        { partNumber: 2, etag: "etag-2" },
      ]);

      // KV should be cleaned up
      expect(mockKV.delete).toHaveBeenCalledWith("multipart:mp-upload-123");
    });

    it("returns error when multipart upload session is missing", async () => {
      mockKV.get.mockResolvedValue(null);

      const app = createApp();
      const req = makeRequest("/upload/complete-multipart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploadId: "nonexistent-upload",
          r2Key: "some/key",
          parts: [{ partNumber: 1, etag: "etag-1" }],
        }),
      });

      const res = await app.fetch(req, { KV: mockKV, R2: mockR2, DB: mockDB });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("UPLOAD_NOT_FOUND");
    });
  });
});
