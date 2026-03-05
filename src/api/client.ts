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

async function handleResponse<T>(res: Response): Promise<T> {
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
