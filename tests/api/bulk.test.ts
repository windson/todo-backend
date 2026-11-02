import { describe, it, expect } from "vitest";
// Import the Prisma mock helper first so its vi.mock("@/lib/prisma") is
// registered before the route handler loads.
import { prismaMock } from "../helpers/prisma-mock";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/todos/bulk/route";
import { createToken } from "@/lib/auth";

const authToken = await createToken({ userId: "user-1", email: "user@example.com" });

function makeRequest(body: unknown): NextRequest {
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.set("authorization", `Bearer ${authToken}`);
  return new NextRequest(
    new Request("http://localhost/api/todos/bulk", {
      method: "POST",
      body: JSON.stringify(body),
      headers,
    })
  );
}

describe("POST /api/todos/bulk - setPriority", () => {
  it("updates priority on owned todos", async () => {
    prismaMock.todo.updateMany.mockResolvedValue({ count: 2 } as never);

    const res = await POST(makeRequest({ operation: "setPriority", ids: ["a", "b"], priority: "HIGH" }));

    expect(res.status).toBe(200);
    const updateArg = prismaMock.todo.updateMany.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: { in: ["a", "b"] }, userId: "user-1" });
    expect(updateArg.data).toEqual({ priority: "HIGH" });
  });

  it("rejects an invalid priority", async () => {
    const res = await POST(makeRequest({ operation: "setPriority", ids: ["a"], priority: "SOMEDAY" }));
    expect(res.status).toBe(400);
    expect(prismaMock.todo.updateMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/todos/bulk - setCategory", () => {
  it("validates the category belongs to the user before assigning", async () => {
    prismaMock.category.findFirst.mockResolvedValue({ id: "cat-1", userId: "user-1" } as never);
    prismaMock.todo.updateMany.mockResolvedValue({ count: 3 } as never);

    const res = await POST(makeRequest({ operation: "setCategory", ids: ["a", "b", "c"], categoryId: "cat-1" }));

    expect(res.status).toBe(200);
    expect(prismaMock.category.findFirst).toHaveBeenCalledWith({
      where: { id: "cat-1", userId: "user-1" },
    });
    const updateArg = prismaMock.todo.updateMany.mock.calls[0][0];
    expect(updateArg.data).toEqual({ categoryId: "cat-1" });
  });

  it("rejects a category the user does not own", async () => {
    prismaMock.category.findFirst.mockResolvedValue(null);

    const res = await POST(makeRequest({ operation: "setCategory", ids: ["a"], categoryId: "other" }));

    expect(res.status).toBe(400);
    expect(prismaMock.todo.updateMany).not.toHaveBeenCalled();
  });

  it("clears the category when categoryId is null without a lookup", async () => {
    prismaMock.todo.updateMany.mockResolvedValue({ count: 1 } as never);

    const res = await POST(makeRequest({ operation: "setCategory", ids: ["a"], categoryId: null }));

    expect(res.status).toBe(200);
    expect(prismaMock.category.findFirst).not.toHaveBeenCalled();
    const updateArg = prismaMock.todo.updateMany.mock.calls[0][0];
    expect(updateArg.data).toEqual({ categoryId: null });
  });
});

describe("POST /api/todos/bulk - addTags", () => {
  it("validates tags belong to the user and creates join rows", async () => {
    prismaMock.tag.findMany.mockResolvedValue([
      { id: "tag-1", userId: "user-1" },
      { id: "tag-2", userId: "user-1" },
    ] as never);
    prismaMock.todo.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }] as never);
    prismaMock.todoTag.createMany.mockResolvedValue({ count: 4 } as never);

    const res = await POST(makeRequest({ operation: "addTags", ids: ["a", "b"], tagIds: ["tag-1", "tag-2"] }));

    expect(res.status).toBe(200);
    const createArg = prismaMock.todoTag.createMany.mock.calls[0][0];
    expect(createArg.skipDuplicates).toBe(true);
    expect(createArg.data).toHaveLength(4);
  });

  it("rejects a tag the user does not own", async () => {
    prismaMock.tag.findMany.mockResolvedValue([{ id: "tag-1", userId: "user-1" }] as never);

    const res = await POST(makeRequest({ operation: "addTags", ids: ["a"], tagIds: ["tag-1", "other"] }));

    expect(res.status).toBe(400);
    expect(prismaMock.todoTag.createMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/todos/bulk - removeTags", () => {
  it("removes join rows for owned todos only", async () => {
    prismaMock.todo.findMany.mockResolvedValue([{ id: "a" }] as never);
    prismaMock.todoTag.deleteMany.mockResolvedValue({ count: 1 } as never);

    const res = await POST(makeRequest({ operation: "removeTags", ids: ["a"], tagIds: ["tag-1"] }));

    expect(res.status).toBe(200);
    const deleteArg = prismaMock.todoTag.deleteMany.mock.calls[0][0];
    expect(deleteArg.where).toEqual({ todoId: { in: ["a"] }, tagId: { in: ["tag-1"] } });
  });
});

describe("POST /api/todos/bulk - caps and existing operations", () => {
  it("enforces the 50-item cap", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `id-${i}`);
    const res = await POST(makeRequest({ operation: "delete", ids }));
    expect(res.status).toBe(400);
    expect(prismaMock.todo.deleteMany).not.toHaveBeenCalled();
  });

  it("still supports delete", async () => {
    prismaMock.todo.deleteMany.mockResolvedValue({ count: 2 } as never);
    const res = await POST(makeRequest({ operation: "delete", ids: ["a", "b"] }));
    expect(res.status).toBe(200);
    const deleteArg = prismaMock.todo.deleteMany.mock.calls[0][0];
    expect(deleteArg.where).toEqual({ id: { in: ["a", "b"] }, userId: "user-1" });
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await POST(
      new NextRequest(
        new Request("http://localhost/api/todos/bulk", {
          method: "POST",
          body: JSON.stringify({ operation: "delete", ids: ["a"] }),
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    expect(res.status).toBe(401);
  });
});

describe("POST /api/todos/bulk - setAssignee", () => {
  it("clears the assignee on owned todos when assigneeId is null", async () => {
    prismaMock.todo.findMany.mockResolvedValue([{ id: "a", title: "A" }] as never);
    prismaMock.todo.updateMany.mockResolvedValue({ count: 1 } as never);

    const res = await POST(makeRequest({ operation: "setAssignee", ids: ["a"], assigneeId: null }));

    expect(res.status).toBe(200);
    const updateArg = prismaMock.todo.updateMany.mock.calls[0][0];
    expect(updateArg.data).toEqual({ assigneeId: null });
    // No share lookup needed when clearing.
    expect(prismaMock.todoShare.findMany).not.toHaveBeenCalled();
  });

  it("assigns the owner to their own todos without a share lookup", async () => {
    prismaMock.todo.findMany.mockResolvedValue([{ id: "a", title: "A" }] as never);
    prismaMock.todo.updateMany.mockResolvedValue({ count: 1 } as never);

    const res = await POST(makeRequest({ operation: "setAssignee", ids: ["a"], assigneeId: "user-1" }));

    expect(res.status).toBe(200);
    expect(prismaMock.todoShare.findMany).not.toHaveBeenCalled();
  });

  it("assigns a shared user when they are shared on every affected todo", async () => {
    prismaMock.todo.findMany.mockResolvedValue([
      { id: "a", title: "A" },
      { id: "b", title: "B" },
    ] as never);
    prismaMock.todoShare.findMany.mockResolvedValue([
      { todoId: "a" },
      { todoId: "b" },
    ] as never);
    prismaMock.todo.updateMany.mockResolvedValue({ count: 2 } as never);

    const res = await POST(makeRequest({ operation: "setAssignee", ids: ["a", "b"], assigneeId: "editor" }));

    expect(res.status).toBe(200);
    // Notifies the assignee for each affected todo.
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(2);
  });

  it("rejects assigning a user not shared on all affected todos (400)", async () => {
    prismaMock.todo.findMany.mockResolvedValue([
      { id: "a", title: "A" },
      { id: "b", title: "B" },
    ] as never);
    prismaMock.todoShare.findMany.mockResolvedValue([{ todoId: "a" }] as never);

    const res = await POST(makeRequest({ operation: "setAssignee", ids: ["a", "b"], assigneeId: "editor" }));

    expect(res.status).toBe(400);
    expect(prismaMock.todo.updateMany).not.toHaveBeenCalled();
  });
});
