import { describe, it, expect } from "vitest";
import { json, error, paginated } from "./response";

describe("json", () => {
  it("returns success response with data", async () => {
    const response = json({ name: "test" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, data: { name: "test" } });
  });

  it("supports custom status codes", async () => {
    const response = json({ id: "123" }, 201);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({ success: true, data: { id: "123" } });
  });

  it("handles null data", async () => {
    const response = json(null);
    const body = await response.json();

    expect(body).toEqual({ success: true, data: null });
  });

  it("handles array data", async () => {
    const response = json([1, 2, 3]);
    const body = await response.json();

    expect(body).toEqual({ success: true, data: [1, 2, 3] });
  });
});

describe("error", () => {
  it("returns error response", async () => {
    const response = error("Something went wrong", "BAD_REQUEST");
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      success: false,
      error: { message: "Something went wrong", code: "BAD_REQUEST" },
    });
  });

  it("supports custom status codes", async () => {
    const response = error("Not found", "NOT_FOUND", 404);
    const body = await response.json() as { error: { message: string; code: string } };

    expect(response.status).toBe(404);
    expect(body.error.message).toBe("Not found");
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("defaults to 400 status", async () => {
    const response = error("Bad", "BAD");
    expect(response.status).toBe(400);
  });
});

describe("paginated", () => {
  it("returns paginated response with meta", async () => {
    const items = [{ id: 1 }, { id: 2 }];
    const response = paginated(items, 50, 1, 20);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: items,
      meta: { total: 50, page: 1, per_page: 20 },
    });
  });

  it("handles empty data", async () => {
    const response = paginated([], 0, 1, 20);
    const body = await response.json() as { data: unknown[]; meta: { total: number } };

    expect(body.data).toEqual([]);
    expect(body.meta.total).toBe(0);
  });
});
