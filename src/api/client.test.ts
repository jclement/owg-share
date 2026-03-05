import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiError, handleResponse, api, multipartUpload, fetchPaginated, MULTIPART_THRESHOLD } from "./client";

describe("ApiError", () => {
  it("creates an error with code, message, and status", () => {
    const err = new ApiError("NOT_FOUND", "Resource not found", 404);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("Resource not found");
    expect(err.status).toBe(404);
    expect(err.name).toBe("ApiError");
    expect(err instanceof Error).toBe(true);
  });

  it("can be caught as Error", () => {
    const err = new ApiError("TEST", "test", 400);
    try {
      throw err;
    } catch (e) {
      expect(e instanceof Error).toBe(true);
      expect(e instanceof ApiError).toBe(true);
    }
  });
});

describe("handleResponse", () => {
  it("returns data from successful response", async () => {
    const res = new Response(JSON.stringify({ success: true, data: { id: "123", name: "test" } }), { status: 200 });
    const result = await handleResponse<{ id: string; name: string }>(res);
    expect(result).toEqual({ id: "123", name: "test" });
  });

  it("throws ApiError with correct properties for error response", async () => {
    const res = new Response(JSON.stringify({ success: false, error: { code: "EXPIRED", message: "Share expired" } }), { status: 410 });
    try {
      await handleResponse(res);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe("EXPIRED");
      expect((e as ApiError).message).toBe("Share expired");
      expect((e as ApiError).status).toBe(410);
    }
  });

  it("defaults to UNKNOWN code when no error code", async () => {
    const res = new Response(JSON.stringify({ success: false }), { status: 500 });
    try {
      await handleResponse(res);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as ApiError).code).toBe("UNKNOWN");
      expect((e as ApiError).status).toBe(500);
    }
  });

  it("treats non-ok status as error even without success field", async () => {
    const res = new Response(JSON.stringify({ data: "nope" }), { status: 403 });
    await expect(handleResponse(res)).rejects.toThrow(ApiError);
  });

  it("returns null data", async () => {
    const res = new Response(JSON.stringify({ success: true, data: null }), { status: 200 });
    expect(await handleResponse(res)).toBeNull();
  });

  it("returns array data", async () => {
    const res = new Response(JSON.stringify({ success: true, data: [1, 2, 3] }), { status: 200 });
    expect(await handleResponse<number[]>(res)).toEqual([1, 2, 3]);
  });
});

describe("api methods", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("api.get sends GET with credentials", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { ok: true } })));
    await api.get("/api/test");
    expect(mockFetch).toHaveBeenCalledWith("/api/test", { credentials: "same-origin" });
  });

  it("api.post sends POST with JSON body", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: {} })));
    await api.post("/api/test", { name: "test" });
    expect(mockFetch).toHaveBeenCalledWith("/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"name":"test"}',
      credentials: "same-origin",
    });
  });

  it("api.post with no body sends undefined", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: {} })));
    await api.post("/api/test");
    expect(mockFetch.mock.calls[0][1].body).toBeUndefined();
  });

  it("api.put sends PUT with JSON body", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: {} })));
    await api.put("/api/test", { title: "updated" });
    expect(mockFetch.mock.calls[0][1].method).toBe("PUT");
  });

  it("api.delete sends DELETE", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { deleted: true } })));
    const result = await api.delete<{ deleted: boolean }>("/api/test/123");
    expect(mockFetch.mock.calls[0][1].method).toBe("DELETE");
    expect(result).toEqual({ deleted: true });
  });

  it("api.upload sends PUT with ArrayBuffer", async () => {
    const data = new ArrayBuffer(100);
    mockFetch.mockResolvedValueOnce(new Response("ok"));
    await api.upload("/api/upload/file/abc", data);
    expect(mockFetch.mock.calls[0][1].method).toBe("PUT");
    expect(mockFetch.mock.calls[0][1].body).toBe(data);
  });
});

describe("multipartUpload", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uploads small data in a single chunk", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { uploadId: "u1", r2Key: "user/file.bin" } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { partNumber: 1, etag: "e1" } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { completed: true } })));

    const onProgress = vi.fn();
    const r2Key = await multipartUpload(new ArrayBuffer(1024), "test.bin", "application/octet-stream", onProgress);

    expect(r2Key).toBe("user/file.bin");
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenCalledWith(1);
  });

  it("splits large data into multiple chunks", async () => {
    const CHUNK_SIZE = 50 * 1024 * 1024;
    const dataSize = CHUNK_SIZE * 2 + 1000; // 3 chunks

    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { uploadId: "u2", r2Key: "user/large.bin" } })));
    for (let i = 1; i <= 3; i++) {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { partNumber: i, etag: `e${i}` } })));
    }
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { completed: true } })));

    const onProgress = vi.fn();
    await multipartUpload(new ArrayBuffer(dataSize), "large.bin", "application/octet-stream", onProgress);

    expect(mockFetch).toHaveBeenCalledTimes(5); // presign + 3 parts + complete
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenNthCalledWith(1, 1 / 3);
    expect(onProgress).toHaveBeenNthCalledWith(2, 2 / 3);
    expect(onProgress).toHaveBeenNthCalledWith(3, 1);
  });

  it("throws when a part upload fails", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { uploadId: "u3", r2Key: "user/fail.bin" } })))
      .mockResolvedValueOnce(new Response("error", { status: 500 }));

    await expect(multipartUpload(new ArrayBuffer(1024), "fail.bin", "application/octet-stream")).rejects.toThrow("Failed to upload part 1");
  });

  it("works without progress callback", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { uploadId: "u4", r2Key: "user/np.bin" } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { partNumber: 1, etag: "e1" } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { completed: true } })));

    const r2Key = await multipartUpload(new ArrayBuffer(1024), "test.bin", "application/octet-stream");
    expect(r2Key).toBe("user/np.bin");
  });
});

describe("fetchPaginated", () => {
  const mockFetch = vi.fn();

  beforeEach(() => { vi.stubGlobal("fetch", mockFetch); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns paginated data with meta", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      success: true, data: [{ id: "1" }, { id: "2" }], meta: { total: 50, page: 1, per_page: 20 },
    })));
    const result = await fetchPaginated<{ id: string }>("/api/shares?page=1");
    expect(result.data).toHaveLength(2);
    expect(result.meta).toEqual({ total: 50, page: 1, per_page: 20 });
  });

  it("throws ApiError on error response", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      success: false, error: { code: "UNAUTHORIZED", message: "Not logged in" },
    }), { status: 401 }));
    await expect(fetchPaginated("/api/shares")).rejects.toThrow(ApiError);
  });

  it("handles empty results", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      success: true, data: [], meta: { total: 0, page: 1, per_page: 20 },
    })));
    const result = await fetchPaginated("/api/shares");
    expect(result.data).toEqual([]);
    expect(result.meta.total).toBe(0);
  });
});

describe("MULTIPART_THRESHOLD", () => {
  it("is 90MB", () => {
    expect(MULTIPART_THRESHOLD).toBe(90 * 1024 * 1024);
  });
});
