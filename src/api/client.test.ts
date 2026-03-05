import { describe, it, expect } from "vitest";
import { ApiError } from "./client";

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
