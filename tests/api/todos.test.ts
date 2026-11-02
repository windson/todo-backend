import { describe, it, expect } from "vitest";
// Import the Prisma mock helper first so its `vi.mock("@/lib/prisma")` is
// registered before the route handler (which imports the prisma singleton) is
// loaded below.
import { prismaMock } from "../helpers/prisma-mock";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/todos/route";

function makeRequest(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new Request(url, init));
}

describe("GET /api/todos", () => {
  it("returns a success envelope with the X-Total-Count header", async () => {
    const todos = [
      {
        id: "todo-1",
        title: "Test todo",
        description: null,
        completed: false,
        priority: "MEDIUM",
        dueDate: null,
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
        updatedAt: new Date("2024-01-01T00:00:00.000Z"),
        categoryId: null,
        order: 0,
        category: null,
        tags: [],
      },
    ];

    // Promise.all([findMany, count]) in the handler.
    prismaMock.todo.findMany.mockResolvedValue(todos as never);
    prismaMock.todo.count.mockResolvedValue(1);

    const res = await GET(makeRequest("http://localhost/api/todos"));

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Total-Count")).toBe("1");

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("todo-1");
    // Tags are flattened from the join table to the Tag objects.
    expect(body.data[0].tags).toEqual([]);
  });

  it("returns a 400 error envelope for invalid query parameters", async () => {
    const res = await GET(
      makeRequest("http://localhost/api/todos?limit=500")
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.message).toBe("Invalid query parameters");
    // Prisma should never be queried when validation fails.
    expect(prismaMock.todo.findMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/todos", () => {
  it("creates a todo and returns a 201 created envelope", async () => {
    const created = {
      id: "todo-2",
      title: "New todo",
      description: null,
      completed: false,
      priority: "MEDIUM",
      dueDate: null,
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
      updatedAt: new Date("2024-01-01T00:00:00.000Z"),
      categoryId: null,
      order: 0,
      category: null,
      tags: [],
    };
    prismaMock.todo.create.mockResolvedValue(created as never);

    const res = await POST(
      makeRequest("http://localhost/api/todos", {
        method: "POST",
        body: JSON.stringify({ title: "New todo" }),
        headers: { "Content-Type": "application/json" },
      })
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("todo-2");
    expect(prismaMock.todo.create).toHaveBeenCalledOnce();
  });

  it("returns a 400 error envelope when the title is missing", async () => {
    const res = await POST(
      makeRequest("http://localhost/api/todos", {
        method: "POST",
        body: JSON.stringify({ description: "no title" }),
        headers: { "Content-Type": "application/json" },
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.message).toBe("Validation failed");
    expect(prismaMock.todo.create).not.toHaveBeenCalled();
  });
});
