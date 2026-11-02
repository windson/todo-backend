import { describe, it, expect } from "vitest";
import { prismaMock } from "../helpers/prisma-mock";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/todos/[id]/activity/route";
import { PATCH } from "@/app/api/todos/[id]/route";
import { logActivity, ActivityAction } from "@/lib/activity";
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
    title: "Task",
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
    userId: "user-1",
    category: null,
    tags: [],
    children: [],
    ...overrides,
  };
}

describe("lib/activity logActivity", () => {
  it("writes an activity row via the given client", async () => {
    prismaMock.activityLog.create.mockResolvedValue({} as never);

    await logActivity(prismaMock, {
      todoId: "todo-1",
      userId: "user-1",
      action: ActivityAction.TODO_CREATED,
      metadata: { title: "Task" },
    });

    expect(prismaMock.activityLog.create).toHaveBeenCalledOnce();
    const arg = prismaMock.activityLog.create.mock.calls[0][0];
    expect(arg.data).toMatchObject({
      todoId: "todo-1",
      userId: "user-1",
      action: "todo.created",
    });
  });

  it("swallows errors so logging never breaks the primary operation", async () => {
    prismaMock.activityLog.create.mockRejectedValue(new Error("db down"));

    await expect(
      logActivity(prismaMock, { todoId: "t", userId: "u", action: "todo.updated" })
    ).resolves.toBeUndefined();
  });
});

describe("GET /api/todos/:id/activity", () => {
  it("returns the activity log for an owned todo", async () => {
    prismaMock.todo.findFirst.mockResolvedValue({ id: "todo-1", userId: "user-1" } as never);
    prismaMock.activityLog.findMany.mockResolvedValue([
      { id: "a1", action: "todo.created", metadata: null, todoId: "todo-1", userId: "user-1", createdAt: new Date() },
    ] as never);

    const res = await GET(makeRequest("http://localhost/api/todos/todo-1/activity"), {
      params: Promise.resolve({ id: "todo-1" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].action).toBe("todo.created");
  });

  it("returns 404 when the todo is not owned", async () => {
    prismaMock.todo.findFirst.mockResolvedValue(null);

    const res = await GET(makeRequest("http://localhost/api/todos/other/activity"), {
      params: Promise.resolve({ id: "other" }),
    });

    expect(res.status).toBe(404);
    expect(prismaMock.activityLog.findMany).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/todos/:id writes activity", () => {
  it("logs a completion when a todo is marked completed", async () => {
    prismaMock.todo.findFirst.mockResolvedValue(
      makeTodo({ completed: false, children: [], tags: [] }) as never
    );
    prismaMock.todo.update.mockResolvedValue(makeTodo({ completed: true }) as never);

    const res = await PATCH(
      makeRequest("http://localhost/api/todos/todo-1", {
        method: "PATCH",
        body: JSON.stringify({ completed: true }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "todo-1" }) }
    );

    expect(res.status).toBe(200);
    expect(prismaMock.activityLog.create).toHaveBeenCalledOnce();
    const arg = prismaMock.activityLog.create.mock.calls[0][0];
    expect(arg.data.action).toBe("todo.completed");
  });

  it("logs a generic update when non-completion fields change", async () => {
    prismaMock.todo.findFirst.mockResolvedValue(
      makeTodo({ completed: false, children: [], tags: [] }) as never
    );
    prismaMock.todo.update.mockResolvedValue(makeTodo({ title: "Renamed" }) as never);

    const res = await PATCH(
      makeRequest("http://localhost/api/todos/todo-1", {
        method: "PATCH",
        body: JSON.stringify({ title: "Renamed" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "todo-1" }) }
    );

    expect(res.status).toBe(200);
    const arg = prismaMock.activityLog.create.mock.calls[0][0];
    expect(arg.data.action).toBe("todo.updated");
    expect(arg.data.metadata).toMatchObject({ fields: ["title"] });
  });
});
