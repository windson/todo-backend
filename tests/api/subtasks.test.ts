import { describe, it, expect } from "vitest";
// Import the Prisma mock helper first so its `vi.mock("@/lib/prisma")` is
// registered before the route handlers (which import the prisma singleton)
// are loaded below.
import { prismaMock } from "../helpers/prisma-mock";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/todos/route";
import { PATCH } from "@/app/api/todos/[id]/route";
import { createToken } from "@/lib/auth";

const authToken = await createToken({ userId: "user-1", email: "user@example.com" });

function makeRequest(url: string, init?: RequestInit): NextRequest {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${authToken}`);
  return new NextRequest(new Request(url, { ...init, headers }));
}

function makeTodo(overrides: Record<string, unknown> = {}) {
  return {
    id: "todo-1",
    title: "Parent",
    description: null,
    completed: false,
    priority: "MEDIUM",
    dueDate: null,
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    categoryId: null,
    parentId: null,
    order: 0,
    category: null,
    tags: [],
    children: [],
    ...overrides,
  };
}

describe("POST /api/todos (subtasks)", () => {
  it("creates a subtask when parentId references an owned top-level todo", async () => {
    // Parent ownership lookup.
    prismaMock.todo.findFirst.mockResolvedValue(
      makeTodo({ id: "parent-1", parentId: null }) as never
    );
    const created = makeTodo({ id: "child-1", title: "Subtask", parentId: "parent-1" });
    prismaMock.todo.create.mockResolvedValue(created as never);

    const res = await POST(
      makeRequest("http://localhost/api/todos", {
        method: "POST",
        body: JSON.stringify({ title: "Subtask", parentId: "parent-1" }),
        headers: { "Content-Type": "application/json" },
      })
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.parentId).toBe("parent-1");
    // The handler exposes a computed progress summary.
    expect(body.data.progress).toEqual({ total: 0, completed: 0 });
    expect(prismaMock.todo.create).toHaveBeenCalledOnce();
  });

  it("rejects a subtask whose parent is not found / not owned", async () => {
    prismaMock.todo.findFirst.mockResolvedValue(null);

    const res = await POST(
      makeRequest("http://localhost/api/todos", {
        method: "POST",
        body: JSON.stringify({ title: "Subtask", parentId: "missing" }),
        headers: { "Content-Type": "application/json" },
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.message).toBe("Parent todo not found");
    expect(prismaMock.todo.create).not.toHaveBeenCalled();
  });

  it("rejects nesting a subtask under another subtask", async () => {
    prismaMock.todo.findFirst.mockResolvedValue(
      makeTodo({ id: "parent-1", parentId: "grandparent" }) as never
    );

    const res = await POST(
      makeRequest("http://localhost/api/todos", {
        method: "POST",
        body: JSON.stringify({ title: "Subtask", parentId: "parent-1" }),
        headers: { "Content-Type": "application/json" },
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toBe("Cannot nest a subtask under another subtask");
    expect(prismaMock.todo.create).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/todos/:id (subtasks)", () => {
  function makeContext(id: string) {
    return { params: Promise.resolve({ id }) };
  }

  it("rejects making a todo its own parent", async () => {
    prismaMock.todo.findFirst.mockResolvedValue(
      makeTodo({ id: "todo-1", children: [] }) as never
    );

    const res = await PATCH(
      makeRequest("http://localhost/api/todos/todo-1", {
        method: "PATCH",
        body: JSON.stringify({ parentId: "todo-1" }),
        headers: { "Content-Type": "application/json" },
      }),
      makeContext("todo-1")
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toBe("A todo cannot be its own parent");
    expect(prismaMock.todo.update).not.toHaveBeenCalled();
  });

  it("rejects moving a todo that has subtasks under another todo", async () => {
    prismaMock.todo.findFirst.mockResolvedValue(
      makeTodo({ id: "todo-1", children: [{ id: "child-1" }] }) as never
    );

    const res = await PATCH(
      makeRequest("http://localhost/api/todos/todo-1", {
        method: "PATCH",
        body: JSON.stringify({ parentId: "parent-2" }),
        headers: { "Content-Type": "application/json" },
      }),
      makeContext("todo-1")
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toBe("Cannot move a todo that has subtasks under another todo");
    expect(prismaMock.todo.update).not.toHaveBeenCalled();
  });
});

describe("GET /api/todos (progress computation)", () => {
  it("computes a progress summary from a parent's children", async () => {
    const todos = [
      makeTodo({
        id: "parent-1",
        title: "Parent",
        children: [
          makeTodo({ id: "c1", completed: true, tags: [] }),
          makeTodo({ id: "c2", completed: true, tags: [] }),
          makeTodo({ id: "c3", completed: false, tags: [] }),
        ],
      }),
    ];
    prismaMock.todo.findMany.mockResolvedValue(todos as never);
    prismaMock.todo.count.mockResolvedValue(1);

    const res = await GET(makeRequest("http://localhost/api/todos"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].progress).toEqual({ total: 3, completed: 2 });
    expect(body.data[0].children).toHaveLength(3);
  });
});
