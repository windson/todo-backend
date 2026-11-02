import { describe, it, expect } from "vitest";
// Import the Prisma mock helper first so its `vi.mock("@/lib/prisma")` is
// registered before the route handlers are loaded below.
import { prismaMock } from "../helpers/prisma-mock";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/todos/[id]/comments/route";
import { PATCH, DELETE } from "@/app/api/todos/[id]/comments/[commentId]/route";
import { createToken } from "@/lib/auth";

const authToken = await createToken({ userId: "user-1", email: "user@example.com" });

function makeRequest(url: string, init?: RequestInit): NextRequest {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${authToken}`);
  return new NextRequest(new Request(url, { ...init, headers }));
}

const ownedTodo = { id: "todo-1", userId: "user-1" };

function makeComment(overrides: Record<string, unknown> = {}) {
  return {
    id: "comment-1",
    body: "Hello",
    todoId: "todo-1",
    userId: "user-1",
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("GET /api/todos/:id/comments", () => {
  it("returns the comment thread for an owned todo", async () => {
    prismaMock.todo.findFirst.mockResolvedValue(ownedTodo as never);
    prismaMock.comment.findMany.mockResolvedValue([makeComment()] as never);

    const res = await GET(makeRequest("http://localhost/api/todos/todo-1/comments"), {
      params: Promise.resolve({ id: "todo-1" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].body).toBe("Hello");
  });

  it("returns 404 when the todo is not owned", async () => {
    prismaMock.todo.findFirst.mockResolvedValue(null);

    const res = await GET(makeRequest("http://localhost/api/todos/other/comments"), {
      params: Promise.resolve({ id: "other" }),
    });

    expect(res.status).toBe(404);
    expect(prismaMock.comment.findMany).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await GET(
      new NextRequest(new Request("http://localhost/api/todos/todo-1/comments")),
      { params: Promise.resolve({ id: "todo-1" }) }
    );

    expect(res.status).toBe(401);
  });
});

describe("POST /api/todos/:id/comments", () => {
  it("creates a comment and writes an activity-log entry", async () => {
    prismaMock.todo.findFirst.mockResolvedValue(ownedTodo as never);
    prismaMock.comment.create.mockResolvedValue(makeComment({ body: "New comment" }) as never);

    const res = await POST(
      makeRequest("http://localhost/api/todos/todo-1/comments", {
        method: "POST",
        body: JSON.stringify({ body: "New comment" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "todo-1" }) }
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.body).toBe("New comment");
    expect(prismaMock.comment.create).toHaveBeenCalledOnce();
    // The comment action is recorded in the activity log.
    expect(prismaMock.activityLog.create).toHaveBeenCalledOnce();
    const activityArg = prismaMock.activityLog.create.mock.calls[0][0];
    expect(activityArg.data.action).toBe("comment.created");
  });

  it("rejects an empty comment body", async () => {
    prismaMock.todo.findFirst.mockResolvedValue(ownedTodo as never);

    const res = await POST(
      makeRequest("http://localhost/api/todos/todo-1/comments", {
        method: "POST",
        body: JSON.stringify({ body: "" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "todo-1" }) }
    );

    expect(res.status).toBe(400);
    expect(prismaMock.comment.create).not.toHaveBeenCalled();
  });

  it("returns 404 when posting to a todo the user does not own", async () => {
    prismaMock.todo.findFirst.mockResolvedValue(null);

    const res = await POST(
      makeRequest("http://localhost/api/todos/other/comments", {
        method: "POST",
        body: JSON.stringify({ body: "Hi" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "other" }) }
    );

    expect(res.status).toBe(404);
    expect(prismaMock.comment.create).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/todos/:id/comments/:commentId", () => {
  it("updates an owned comment", async () => {
    prismaMock.todo.findFirst.mockResolvedValue(ownedTodo as never);
    prismaMock.comment.findFirst.mockResolvedValue(makeComment() as never);
    prismaMock.comment.update.mockResolvedValue(makeComment({ body: "Edited" }) as never);

    const res = await PATCH(
      makeRequest("http://localhost/api/todos/todo-1/comments/comment-1", {
        method: "PATCH",
        body: JSON.stringify({ body: "Edited" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "todo-1", commentId: "comment-1" }) }
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.body).toBe("Edited");
  });

  it("returns 404 when the comment is not owned by the user", async () => {
    prismaMock.todo.findFirst.mockResolvedValue(ownedTodo as never);
    prismaMock.comment.findFirst.mockResolvedValue(null);

    const res = await PATCH(
      makeRequest("http://localhost/api/todos/todo-1/comments/other", {
        method: "PATCH",
        body: JSON.stringify({ body: "Edited" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "todo-1", commentId: "other" }) }
    );

    expect(res.status).toBe(404);
    expect(prismaMock.comment.update).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/todos/:id/comments/:commentId", () => {
  it("deletes an owned comment", async () => {
    prismaMock.todo.findFirst.mockResolvedValue(ownedTodo as never);
    prismaMock.comment.findFirst.mockResolvedValue(makeComment() as never);
    prismaMock.comment.delete.mockResolvedValue(makeComment() as never);

    const res = await DELETE(
      makeRequest("http://localhost/api/todos/todo-1/comments/comment-1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "todo-1", commentId: "comment-1" }) }
    );

    expect(res.status).toBe(200);
    expect(prismaMock.comment.delete).toHaveBeenCalledOnce();
    const activityArg = prismaMock.activityLog.create.mock.calls[0][0];
    expect(activityArg.data.action).toBe("comment.deleted");
  });

  it("returns 404 when deleting a comment the user does not own", async () => {
    prismaMock.todo.findFirst.mockResolvedValue(ownedTodo as never);
    prismaMock.comment.findFirst.mockResolvedValue(null);

    const res = await DELETE(
      makeRequest("http://localhost/api/todos/todo-1/comments/other", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "todo-1", commentId: "other" }) }
    );

    expect(res.status).toBe(404);
    expect(prismaMock.comment.delete).not.toHaveBeenCalled();
  });
});
