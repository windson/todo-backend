import { describe, it, expect } from "vitest";
// Import the Prisma mock helper first so its vi.mock("@/lib/prisma") is
// registered before the route handlers load.
import { prismaMock } from "../helpers/prisma-mock";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/todos/[id]/reminders/route";
import { PATCH, DELETE } from "@/app/api/todos/[id]/reminders/[reminderId]/route";
import { POST as DISPATCH } from "@/app/api/reminders/dispatch/route";
import { createToken } from "@/lib/auth";

const authToken = await createToken({ userId: "user-1", email: "user@example.com" });

function makeRequest(url: string, init?: RequestInit): NextRequest {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${authToken}`);
  return new NextRequest(new Request(url, { ...init, headers }));
}

const ownedTodo = { id: "todo-1", userId: "user-1", shares: [] };

function makeReminder(overrides: Record<string, unknown> = {}) {
  return {
    id: "reminder-1",
    remindAt: new Date("2024-06-01T09:00:00.000Z"),
    channel: "INAPP",
    sentAt: null,
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    todoId: "todo-1",
    userId: "user-1",
    ...overrides,
  };
}

describe("GET /api/todos/:id/reminders", () => {
  it("lists reminders for an owned todo", async () => {
    prismaMock.todo.findUnique.mockResolvedValue(ownedTodo as never);
    prismaMock.reminder.findMany.mockResolvedValue([makeReminder()] as never);

    const res = await GET(makeRequest("http://localhost/api/todos/todo-1/reminders"), {
      params: Promise.resolve({ id: "todo-1" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
  });

  it("returns 404 when the todo is not owned", async () => {
    prismaMock.todo.findUnique.mockResolvedValue(null);

    const res = await GET(makeRequest("http://localhost/api/todos/x/reminders"), {
      params: Promise.resolve({ id: "x" }),
    });

    expect(res.status).toBe(404);
    expect(prismaMock.reminder.findMany).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await GET(
      new NextRequest(new Request("http://localhost/api/todos/todo-1/reminders")),
      { params: Promise.resolve({ id: "todo-1" }) }
    );
    expect(res.status).toBe(401);
  });
});

describe("POST /api/todos/:id/reminders", () => {
  it("creates a reminder and writes an activity entry", async () => {
    prismaMock.todo.findUnique.mockResolvedValue(ownedTodo as never);
    prismaMock.reminder.create.mockResolvedValue(makeReminder() as never);

    const res = await POST(
      makeRequest("http://localhost/api/todos/todo-1/reminders", {
        method: "POST",
        body: JSON.stringify({ remindAt: "2024-06-01T09:00:00.000Z", channel: "INAPP" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "todo-1" }) }
    );

    expect(res.status).toBe(201);
    expect(prismaMock.reminder.create).toHaveBeenCalledOnce();
    const activityArg = prismaMock.activityLog.create.mock.calls[0][0];
    expect(activityArg.data.action).toBe("reminder.created");
  });

  it("rejects a missing remindAt", async () => {
    prismaMock.todo.findUnique.mockResolvedValue(ownedTodo as never);

    const res = await POST(
      makeRequest("http://localhost/api/todos/todo-1/reminders", {
        method: "POST",
        body: JSON.stringify({ channel: "INAPP" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "todo-1" }) }
    );

    expect(res.status).toBe(400);
    expect(prismaMock.reminder.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid channel", async () => {
    prismaMock.todo.findUnique.mockResolvedValue(ownedTodo as never);

    const res = await POST(
      makeRequest("http://localhost/api/todos/todo-1/reminders", {
        method: "POST",
        body: JSON.stringify({ remindAt: "2024-06-01T09:00:00.000Z", channel: "SMS" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "todo-1" }) }
    );

    expect(res.status).toBe(400);
  });

  it("returns 404 when the todo is not owned", async () => {
    prismaMock.todo.findUnique.mockResolvedValue(null);

    const res = await POST(
      makeRequest("http://localhost/api/todos/x/reminders", {
        method: "POST",
        body: JSON.stringify({ remindAt: "2024-06-01T09:00:00.000Z" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "x" }) }
    );

    expect(res.status).toBe(404);
  });
});

describe("PATCH/DELETE /api/todos/:id/reminders/:reminderId", () => {
  it("updates an owned reminder", async () => {
    prismaMock.todo.findUnique.mockResolvedValue(ownedTodo as never);
    prismaMock.reminder.findFirst.mockResolvedValue(makeReminder() as never);
    prismaMock.reminder.update.mockResolvedValue(makeReminder({ channel: "EMAIL" }) as never);

    const res = await PATCH(
      makeRequest("http://localhost/api/todos/todo-1/reminders/reminder-1", {
        method: "PATCH",
        body: JSON.stringify({ channel: "EMAIL" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "todo-1", reminderId: "reminder-1" }) }
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.channel).toBe("EMAIL");
  });

  it("returns 404 updating a reminder the user does not own", async () => {
    prismaMock.todo.findUnique.mockResolvedValue(ownedTodo as never);
    prismaMock.reminder.findFirst.mockResolvedValue(null);

    const res = await PATCH(
      makeRequest("http://localhost/api/todos/todo-1/reminders/other", {
        method: "PATCH",
        body: JSON.stringify({ channel: "EMAIL" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "todo-1", reminderId: "other" }) }
    );

    expect(res.status).toBe(404);
    expect(prismaMock.reminder.update).not.toHaveBeenCalled();
  });

  it("deletes an owned reminder and logs activity", async () => {
    prismaMock.todo.findUnique.mockResolvedValue(ownedTodo as never);
    prismaMock.reminder.findFirst.mockResolvedValue(makeReminder() as never);
    prismaMock.reminder.delete.mockResolvedValue(makeReminder() as never);

    const res = await DELETE(
      makeRequest("http://localhost/api/todos/todo-1/reminders/reminder-1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "todo-1", reminderId: "reminder-1" }) }
    );

    expect(res.status).toBe(200);
    expect(prismaMock.reminder.delete).toHaveBeenCalledOnce();
    const activityArg = prismaMock.activityLog.create.mock.calls[0][0];
    expect(activityArg.data.action).toBe("reminder.deleted");
  });
});

describe("POST /api/reminders/dispatch", () => {
  it("dispatches due reminders for an authenticated user", async () => {
    prismaMock.reminder.findMany.mockResolvedValue([
      makeReminder({ todo: { title: "Launch" } }),
    ] as never);

    const res = await DISPATCH(
      makeRequest("http://localhost/api/reminders/dispatch", { method: "POST" })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.dispatched).toBe(1);
    expect(prismaMock.notification.create).toHaveBeenCalledOnce();
  });

  it("returns 401 without a user or dispatch secret", async () => {
    const res = await DISPATCH(
      new NextRequest(new Request("http://localhost/api/reminders/dispatch", { method: "POST" }))
    );

    expect(res.status).toBe(401);
    expect(prismaMock.reminder.findMany).not.toHaveBeenCalled();
  });
});
