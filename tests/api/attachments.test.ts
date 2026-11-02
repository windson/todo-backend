import { describe, it, expect } from "vitest";
import { prismaMock } from "../helpers/prisma-mock";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/todos/[id]/attachments/route";
import { DELETE } from "@/app/api/todos/[id]/attachments/[attachmentId]/route";
import { createToken } from "@/lib/auth";

const authToken = await createToken({ userId: "user-1", email: "user@example.com" });

function makeRequest(url: string, init?: RequestInit): NextRequest {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${authToken}`);
  return new NextRequest(new Request(url, { ...init, headers }));
}

const ownedTodo = { id: "todo-1", userId: "user-1", shares: [] };

function makeAttachment(overrides: Record<string, unknown> = {}) {
  return {
    id: "att-1",
    filename: "doc.pdf",
    url: "https://example.com/doc.pdf",
    mimeType: "application/pdf",
    size: 1024,
    todoId: "todo-1",
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("POST /api/todos/:id/attachments", () => {
  it("stores an attachment reference and logs the activity", async () => {
    prismaMock.todo.findUnique.mockResolvedValue(ownedTodo as never);
    prismaMock.attachment.create.mockResolvedValue(makeAttachment() as never);

    const res = await POST(
      makeRequest("http://localhost/api/todos/todo-1/attachments", {
        method: "POST",
        body: JSON.stringify({
          filename: "doc.pdf",
          url: "https://example.com/doc.pdf",
          mimeType: "application/pdf",
          size: 1024,
        }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "todo-1" }) }
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.url).toBe("https://example.com/doc.pdf");
    expect(prismaMock.attachment.create).toHaveBeenCalledOnce();
    const activityArg = prismaMock.activityLog.create.mock.calls[0][0];
    expect(activityArg.data.action).toBe("attachment.added");
  });

  it("rejects a non-http(s) URL", async () => {
    prismaMock.todo.findUnique.mockResolvedValue(ownedTodo as never);

    const res = await POST(
      makeRequest("http://localhost/api/todos/todo-1/attachments", {
        method: "POST",
        body: JSON.stringify({ filename: "evil", url: "javascript:alert(1)" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "todo-1" }) }
    );

    expect(res.status).toBe(400);
    expect(prismaMock.attachment.create).not.toHaveBeenCalled();
  });

  it("rejects a missing filename", async () => {
    prismaMock.todo.findUnique.mockResolvedValue(ownedTodo as never);

    const res = await POST(
      makeRequest("http://localhost/api/todos/todo-1/attachments", {
        method: "POST",
        body: JSON.stringify({ url: "https://example.com/x.pdf" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "todo-1" }) }
    );

    expect(res.status).toBe(400);
    expect(prismaMock.attachment.create).not.toHaveBeenCalled();
  });

  it("returns 404 when the todo is not owned", async () => {
    prismaMock.todo.findUnique.mockResolvedValue(null);

    const res = await POST(
      makeRequest("http://localhost/api/todos/other/attachments", {
        method: "POST",
        body: JSON.stringify({ filename: "doc.pdf", url: "https://example.com/doc.pdf" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "other" }) }
    );

    expect(res.status).toBe(404);
    expect(prismaMock.attachment.create).not.toHaveBeenCalled();
  });
});

describe("GET /api/todos/:id/attachments", () => {
  it("lists attachment references for an owned todo", async () => {
    prismaMock.todo.findUnique.mockResolvedValue(ownedTodo as never);
    prismaMock.attachment.findMany.mockResolvedValue([makeAttachment()] as never);

    const res = await GET(makeRequest("http://localhost/api/todos/todo-1/attachments"), {
      params: Promise.resolve({ id: "todo-1" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
  });
});

describe("DELETE /api/todos/:id/attachments/:attachmentId", () => {
  it("removes an owned attachment", async () => {
    prismaMock.todo.findUnique.mockResolvedValue(ownedTodo as never);
    prismaMock.attachment.findFirst.mockResolvedValue(makeAttachment() as never);
    prismaMock.attachment.delete.mockResolvedValue(makeAttachment() as never);

    const res = await DELETE(
      makeRequest("http://localhost/api/todos/todo-1/attachments/att-1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "todo-1", attachmentId: "att-1" }) }
    );

    expect(res.status).toBe(200);
    expect(prismaMock.attachment.delete).toHaveBeenCalledOnce();
    const activityArg = prismaMock.activityLog.create.mock.calls[0][0];
    expect(activityArg.data.action).toBe("attachment.removed");
  });

  it("returns 404 when the attachment does not belong to the todo", async () => {
    prismaMock.todo.findUnique.mockResolvedValue(ownedTodo as never);
    prismaMock.attachment.findFirst.mockResolvedValue(null);

    const res = await DELETE(
      makeRequest("http://localhost/api/todos/todo-1/attachments/missing", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "todo-1", attachmentId: "missing" }) }
    );

    expect(res.status).toBe(404);
    expect(prismaMock.attachment.delete).not.toHaveBeenCalled();
  });
});
