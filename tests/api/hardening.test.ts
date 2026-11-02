import { describe, it, expect, beforeEach } from "vitest";
// Import the Prisma mock helper first so its vi.mock("@/lib/prisma") is
// registered before the route handlers load.
import { prismaMock } from "../helpers/prisma-mock";
import { NextRequest } from "next/server";
import { GET as LIST_TODOS } from "@/app/api/todos/route";
import { PATCH as PATCH_TODO } from "@/app/api/todos/[id]/route";
import { createToken } from "@/lib/auth";

const authToken = await createToken({ userId: "owner", email: "owner@example.com" });

function makeRequest(url: string, init?: RequestInit): NextRequest {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${authToken}`);
  return new NextRequest(new Request(url, { ...init, headers }));
}

/** A todo as returned by the access resolver + detail includes. */
function ownedTodo(overrides: Record<string, unknown> = {}) {
  return {
    id: "todo-1",
    title: "Todo",
    description: null,
    completed: false,
    priority: "MEDIUM",
    startDate: null,
    dueDate: null,
    recurrenceRule: null,
    recurrenceInterval: 1,
    recurrenceGeneratedId: null,
    order: 0,
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    categoryId: null,
    parentId: null,
    assigneeId: null,
    userId: "owner",
    category: null,
    tags: [],
    children: [],
    assignee: null,
    shares: [],
    ...overrides,
  };
}

describe("GET /api/todos pagination Link headers", () => {
  it("emits RFC 5988 Link relations alongside X-Total-Count", async () => {
    prismaMock.todo.findMany.mockResolvedValue([ownedTodo()] as never);
    prismaMock.todo.count.mockResolvedValue(55);

    const res = await LIST_TODOS(
      makeRequest("http://localhost/api/todos?limit=20&offset=20")
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Total-Count")).toBe("55");

    const link = res.headers.get("Link");
    expect(link).toBeTruthy();
    expect(link).toContain('rel="first"');
    expect(link).toContain('rel="last"');
    expect(link).toContain('rel="prev"');
    expect(link).toContain('rel="next"');
    // next should point at offset 40, last at offset 40 (items 41-55).
    expect(link).toMatch(/offset=40[^>]*>; rel="next"/);
  });
});

describe("PATCH /api/todos/[id] optimistic concurrency", () => {
  beforeEach(() => {
    prismaMock.todo.update.mockResolvedValue(ownedTodo() as never);
    prismaMock.activityLog.create.mockResolvedValue({} as never);
  });

  it("returns 409 when expectedUpdatedAt is stale", async () => {
    // Both the access resolver and the `existing` load use findUnique.
    prismaMock.todo.findUnique.mockResolvedValue(ownedTodo() as never);

    const res = await PATCH_TODO(
      makeRequest("http://localhost/api/todos/todo-1", {
        method: "PATCH",
        body: JSON.stringify({
          title: "New title",
          // Older than the stored updatedAt (2024-01-01).
          expectedUpdatedAt: "2023-06-01T00:00:00.000Z",
        }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "todo-1" }) }
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.message).toMatch(/modified/i);
    // The update must not be attempted on a stale write.
    expect(prismaMock.todo.update).not.toHaveBeenCalled();
  });

  it("returns 409 when the If-Unmodified-Since header is stale", async () => {
    prismaMock.todo.findUnique.mockResolvedValue(ownedTodo() as never);

    const res = await PATCH_TODO(
      makeRequest("http://localhost/api/todos/todo-1", {
        method: "PATCH",
        body: JSON.stringify({ title: "New title" }),
        headers: {
          "Content-Type": "application/json",
          "If-Unmodified-Since": new Date("2023-06-01T00:00:00.000Z").toUTCString(),
        },
      }),
      { params: Promise.resolve({ id: "todo-1" }) }
    );

    expect(res.status).toBe(409);
    expect(prismaMock.todo.update).not.toHaveBeenCalled();
  });

  it("applies the update when expectedUpdatedAt matches", async () => {
    prismaMock.todo.findUnique.mockResolvedValue(ownedTodo() as never);

    const res = await PATCH_TODO(
      makeRequest("http://localhost/api/todos/todo-1", {
        method: "PATCH",
        body: JSON.stringify({
          title: "New title",
          expectedUpdatedAt: "2024-01-01T00:00:00.000Z",
        }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "todo-1" }) }
    );

    expect(res.status).toBe(200);
    expect(prismaMock.todo.update).toHaveBeenCalledOnce();
  });

  it("is backward compatible: no token means an unconditional update", async () => {
    prismaMock.todo.findUnique.mockResolvedValue(ownedTodo() as never);

    const res = await PATCH_TODO(
      makeRequest("http://localhost/api/todos/todo-1", {
        method: "PATCH",
        body: JSON.stringify({ title: "New title" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "todo-1" }) }
    );

    expect(res.status).toBe(200);
    expect(prismaMock.todo.update).toHaveBeenCalledOnce();
  });
});
