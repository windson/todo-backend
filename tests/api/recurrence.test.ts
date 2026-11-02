import { describe, it, expect, beforeEach } from "vitest";
// Import the Prisma mock helper first so its `vi.mock("@/lib/prisma")` applies
// before the route handlers (which import the prisma singleton) are loaded.
import { prismaMock } from "../helpers/prisma-mock";
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/todos/[id]/route";
import { GET } from "@/app/api/todos/route";
import { generateNextOccurrence } from "@/lib/recurrence-service";
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
    title: "Recurring",
    description: null,
    completed: false,
    priority: "MEDIUM",
    startDate: new Date("2024-01-10T00:00:00.000Z"),
    dueDate: new Date("2024-01-12T00:00:00.000Z"),
    recurrenceRule: "WEEKLY",
    recurrenceInterval: 1,
    recurrenceGeneratedId: null,
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    categoryId: null,
    parentId: null,
    order: 0,
    userId: "user-1",
    category: null,
    tags: [],
    children: [],
    ...overrides,
  };
}

describe("generateNextOccurrence", () => {
  beforeEach(() => {
    prismaMock.todo.create.mockResolvedValue({ id: "next-1" } as never);
    prismaMock.todo.update.mockResolvedValue({ id: "todo-1" } as never);
  });

  it("creates the next occurrence with advanced dates and copies fields/tags", async () => {
    const id = await generateNextOccurrence(prismaMock, {
      id: "todo-1",
      title: "Recurring",
      description: "desc",
      priority: "HIGH",
      startDate: new Date("2024-01-10T00:00:00.000Z"),
      dueDate: new Date("2024-01-12T00:00:00.000Z"),
      recurrenceRule: "WEEKLY",
      recurrenceInterval: 1,
      recurrenceGeneratedId: null,
      userId: "user-1",
      categoryId: "cat-1",
      parentId: null,
      tags: [{ tagId: "tag-1" }, { tagId: "tag-2" }],
    });

    expect(id).toBe("next-1");
    expect(prismaMock.todo.create).toHaveBeenCalledOnce();
    const createArg = prismaMock.todo.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createArg.data.title).toBe("Recurring");
    expect(createArg.data.priority).toBe("HIGH");
    expect(createArg.data.categoryId).toBe("cat-1");
    expect(createArg.data.completed).toBe(false);
    expect((createArg.data.startDate as Date).toISOString()).toBe("2024-01-17T00:00:00.000Z");
    expect((createArg.data.dueDate as Date).toISOString()).toBe("2024-01-19T00:00:00.000Z");
    expect(createArg.data.tags).toEqual({ create: [{ tagId: "tag-1" }, { tagId: "tag-2" }] });
    // Source is stamped with the generated occurrence id.
    expect(prismaMock.todo.update).toHaveBeenCalledWith({
      where: { id: "todo-1" },
      data: { recurrenceGeneratedId: "next-1" },
    });
  });

  it("is a no-op when the todo is not recurring", async () => {
    const id = await generateNextOccurrence(prismaMock, {
      id: "todo-1",
      title: "One-off",
      description: null,
      priority: "MEDIUM",
      startDate: new Date("2024-01-10T00:00:00.000Z"),
      dueDate: null,
      recurrenceRule: null,
      recurrenceInterval: 1,
      recurrenceGeneratedId: null,
      userId: "user-1",
      categoryId: null,
      parentId: null,
      tags: [],
    });
    expect(id).toBeNull();
    expect(prismaMock.todo.create).not.toHaveBeenCalled();
  });

  it("is idempotent: does not regenerate when already generated", async () => {
    const id = await generateNextOccurrence(prismaMock, {
      id: "todo-1",
      title: "Recurring",
      description: null,
      priority: "MEDIUM",
      startDate: new Date("2024-01-10T00:00:00.000Z"),
      dueDate: null,
      recurrenceRule: "DAILY",
      recurrenceInterval: 1,
      recurrenceGeneratedId: "already-made",
      userId: "user-1",
      categoryId: null,
      parentId: null,
      tags: [],
    });
    expect(id).toBeNull();
    expect(prismaMock.todo.create).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/todos/:id completion spawns recurrence", () => {
  beforeEach(() => {
    prismaMock.todo.create.mockResolvedValue({ id: "next-1" } as never);
  });

  function makeContext(id: string) {
    return { params: Promise.resolve({ id }) };
  }

  it("creates the next occurrence when a recurring todo is completed", async () => {
    // access resolve + existing lookup (both findUnique with children + tags)
    prismaMock.todo.findUnique.mockResolvedValue(
      makeTodo({ completed: false, tags: [{ tagId: "tag-1" }], children: [] }) as never
    );
    // the update that completes it
    prismaMock.todo.update.mockResolvedValue(makeTodo({ completed: true }) as never);

    const res = await PATCH(
      makeRequest("http://localhost/api/todos/todo-1", {
        method: "PATCH",
        body: JSON.stringify({ completed: true }),
        headers: { "Content-Type": "application/json" },
      }),
      makeContext("todo-1")
    );

    expect(res.status).toBe(200);
    // One update completes the todo, generateNextOccurrence creates + stamps.
    expect(prismaMock.todo.create).toHaveBeenCalledOnce();
  });

  it("does not spawn an occurrence for a non-recurring todo", async () => {
    prismaMock.todo.findUnique.mockResolvedValue(
      makeTodo({ completed: false, recurrenceRule: null, tags: [], children: [] }) as never
    );
    prismaMock.todo.update.mockResolvedValue(
      makeTodo({ completed: true, recurrenceRule: null }) as never
    );

    const res = await PATCH(
      makeRequest("http://localhost/api/todos/todo-1", {
        method: "PATCH",
        body: JSON.stringify({ completed: true }),
        headers: { "Content-Type": "application/json" },
      }),
      makeContext("todo-1")
    );

    expect(res.status).toBe(200);
    expect(prismaMock.todo.create).not.toHaveBeenCalled();
  });
});

describe("GET /api/todos smart due-date filter", () => {
  it("builds a dueDate range for dueFilter=today", async () => {
    prismaMock.todo.findMany.mockResolvedValue([] as never);
    prismaMock.todo.count.mockResolvedValue(0);

    const res = await GET(makeRequest("http://localhost/api/todos?dueFilter=today"));

    expect(res.status).toBe(200);
    const findArg = prismaMock.todo.findMany.mock.calls[0][0] as {
      where: { dueDate?: { gte?: Date; lte?: Date; lt?: Date } };
    };
    expect(findArg.where.dueDate?.gte).toBeInstanceOf(Date);
    expect(findArg.where.dueDate?.lte).toBeInstanceOf(Date);
  });

  it("builds a lt filter for dueFilter=overdue", async () => {
    prismaMock.todo.findMany.mockResolvedValue([] as never);
    prismaMock.todo.count.mockResolvedValue(0);

    const res = await GET(makeRequest("http://localhost/api/todos?dueFilter=overdue"));

    expect(res.status).toBe(200);
    const findArg = prismaMock.todo.findMany.mock.calls[0][0] as {
      where: { dueDate?: { lt?: Date } };
    };
    expect(findArg.where.dueDate?.lt).toBeInstanceOf(Date);
  });

  it("rejects an invalid dueFilter value", async () => {
    const res = await GET(makeRequest("http://localhost/api/todos?dueFilter=someday"));
    expect(res.status).toBe(400);
    expect(prismaMock.todo.findMany).not.toHaveBeenCalled();
  });
});
