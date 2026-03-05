export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function handleResponse<T>(res: Response): Promise<T> {
  const body = await res.json();
  if (!res.ok || !body.success) {
    throw new ApiError(
      body.error?.code || "UNKNOWN",
      body.error?.message || "An error occurred",
      res.status
    );
  }
  return body.data as T;
}

export const api = {
  get: async <T>(path: string): Promise<T> => {
    const res = await fetch(path, { credentials: "same-origin" });
    return handleResponse<T>(res);
  },

  post: async <T>(path: string, body?: unknown): Promise<T> => {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
    return handleResponse<T>(res);
  },

  put: async <T>(path: string, body?: unknown): Promise<T> => {
    const res = await fetch(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
    return handleResponse<T>(res);
  },

  delete: async <T>(path: string): Promise<T> => {
    const res = await fetch(path, { method: "DELETE", credentials: "same-origin" });
    return handleResponse<T>(res);
  },

  upload: async (path: string, data: ArrayBuffer): Promise<Response> => {
    return fetch(path, {
      method: "PUT",
      body: data,
      credentials: "same-origin",
    });
  },
};

const CHUNK_SIZE = 50 * 1024 * 1024; // 50MB chunks (R2 min is 5MB, CF limit is 100MB)
export const MULTIPART_THRESHOLD = 90 * 1024 * 1024; // Use multipart for files > 90MB

export async function multipartUpload(
  data: ArrayBuffer,
  filename: string,
  contentType: string,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  // 1. Create multipart upload
  const { uploadId, r2Key } = await api.post<{ uploadId: string; r2Key: string }>(
    "/api/upload/presign-multipart",
    { filename, contentType },
  );

  // 2. Upload parts
  const parts: Array<{ partNumber: number; etag: string }> = [];
  const totalParts = Math.ceil(data.byteLength / CHUNK_SIZE);

  for (let i = 0; i < totalParts; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, data.byteLength);
    const chunk = data.slice(start, end);
    const partNumber = i + 1;

    const res = await fetch(`/api/upload/multipart-part/${uploadId}/${partNumber}`, {
      method: "PUT",
      body: chunk,
      credentials: "same-origin",
    });
    if (!res.ok) throw new Error(`Failed to upload part ${partNumber}`);

    const result = await res.json() as { success: boolean; data: { partNumber: number; etag: string } };
    parts.push(result.data);

    onProgress?.((i + 1) / totalParts);
  }

  // 3. Complete
  await api.post("/api/upload/complete-multipart", { uploadId, r2Key, parts });

  return r2Key;
}

export type PaginatedResponse<T> = {
  success: true;
  data: T[];
  meta: { total: number; page: number; per_page: number };
};

export async function fetchPaginated<T>(path: string): Promise<PaginatedResponse<T>> {
  const res = await fetch(path, { credentials: "same-origin" });
  const body = await res.json();
  if (!res.ok || !body.success) {
    throw new ApiError(
      body.error?.code || "UNKNOWN",
      body.error?.message || "An error occurred",
      res.status
    );
  }
  return body as PaginatedResponse<T>;
}
