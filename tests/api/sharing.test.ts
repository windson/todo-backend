import { describe, it, expect, beforeEach } from "vitest";
// Import the Prisma mock helper first so its `vi.mock("@/lib/prisma")` is
// registered before the route handlers are loaded below.
import { prismaMock } from "../helpers/prisma-mock";
import { NextRequest } from "next/server";
import { GET as GET_TODO, PATCH as PATCH_TODO, DELETE as DELETE_TODO } from "@/app/api/todos/[id]/route";
import { GET as LIST_TODOS } from "@/app/api/todos/route";
import { GET as GET_SHARES, POST as CREATE_SHARE } from "@/app/api/todos/[id]/share/route";
import { PATCH as PATCH_SHARE, DELETE as DELETE_SHARE } from "@/app/api/todos/[id]/share/[userId]/route";
import { GET as LOOKUP } from "@/app/api/users/lookup/route";
import { createToken } from "@/lib/auth";

async function tokenFor(userId: string): Promise<string> {
  return createToken({ userId, email: `${userId}@example.com` });
}

function makeRequest(url: string, token: string, init?: RequestInit): NextRequest {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${token}`);
  return new NextRequest(new Request(url, { ...init, headers }));
}

// Tokens for each actor in the access matrix.
const ownerToken = await tokenFor("owner");
const editorToken = await tokenFor("editor");
const viewerToken = await tokenFor("viewer");
const strangerToken = await tokenFor("stranger");

/** A todo as returned by the access resolver + detail includes. */
function accessTodo(overrides: Record<string, unknown> = {}) {
  return {
    id: "todo-1",
    title: "Shared todo",
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

describe("Todo access matrix (owner / editor / viewer / stranger)", () => {
  beforeEach(() => {
    prismaMock.todo.update.mockResolvedValue(accessTodo() as never);
  });

  it("owner can read the todo", async () => {
    prismaMock.todo.findUnique.mockResolvedValue(accessTodo() as never);
    const res = await GET_TODO(
      makeRequest("http://localhost/api/todos/todo-1", ownerToken),
      { params: Promise.resolve({ id: "todo-1" }) }
    );
    expect(res.status).toBe(200);
  });

  it("editor can read and write the todo", async () => {
    prismaMock.todo.findUnique.mockResolvedValue(
      accessTodo({ shares: [{ role: "EDITOR" }] }) as never
    );
    const readRes = await GET_TODO(
      makeRequest("http://localhost/api/todos/todo-1", editorToken),
      { params: Promise.resolve({ id: "todo-1" }) }
    );
    expect(readRes.status).toBe(200);

    const writeRes = await PATCH_TODO(
      makeRequest("http://localhost/api/todos/todo-1", editorToken, {
        method: "PATCH",
        body: JSON.stringify({ title: "Edited by editor" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "todo-1" }) }
    );
    expect(writeRes.status).toBe(200);
    expect(prismaMock.todo.update).toHaveBeenCalled();
  });

  it("viewer can read but NOT write the todo (403)", async () => {
    prismaMock.todo.findUnique.mockResolvedValue(
      accessTodo({ shares: [{ role: "VIEWER" }] }) as never
    );
    const readRes = await GET_TODO(
      makeRequest("http://localhost/api/todos/todo-1", viewerToken),
      { params: Promise.resolve({ id: "todo-1" }) }
    );
    expect(readRes.status).toBe(200);

    const writeRes = await PATCH_TODO(
      makeRequest("http://localhost/api/todos/todo-1", viewerToken, {
        method: "PATCH",
        body: JSON.stringify({ title: "Nope" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "todo-1" }) }
    );
    expect(writeRes.status).toBe(403);
    expect(prismaMock.todo.update).not.toHaveBeenCalled();
  });

  it("stranger cannot read the todo (404, hides existence)", async () => {
    // No ownership and no share -> resolver returns null -> 404.
    prismaMock.todo.findUnique.mockResolvedValue(accessTodo({ shares: [] }) as never);
    const res = await GET_TODO(
      makeRequest("http://localhost/api/todos/todo-1", strangerToken),
      { params: Promise.resolve({ id: "todo-1" }) }
    );
    expect(res.status).toBe(404);
  });

  it("only the owner can delete; an editor is forbidden (403)", async () => {
    prismaMock.todo.findUnique.mockResolvedValue(
      accessTodo({ shares: [{ role: "EDITOR" }] }) as never
    );
    const res = await DELETE_TODO(
      makeRequest("http://localhost/api/todos/todo-1", editorToken, { method: "DELETE" }),
      { params: Promise.resolve({ id: "todo-1" }) }
    );
    expect(res.status).toBe(403);
    expect(prismaMock.todo.delete).not.toHaveBeenCalled();
  });
});

describe("GET /api/todos scoping (owned + shared)", () => {
  it("scopes the default list to owned OR shared todos", async () => {
    prismaMock.todo.findMany.mockResolvedValue([] as never);
    prismaMock.todo.count.mockResolvedValue(0);

    await LIST_TODOS(makeRequest("http://localhost/api/todos", ownerToken));

    const arg = prismaMock.todo.findMany.mock.calls[0][0] as {
      where: { OR?: Array<Record<string, unknown>> };
    };
    expect(arg.where.OR).toEqual([
      { userId: "owner" },
      { shares: { some: { userId: "owner" } } },
    ]);
  });

  it("sharedWithMe=true narrows to todos shared with (not owned by) the user", async () => {
    prismaMock.todo.findMany.mockResolvedValue([] as never);
    prismaMock.todo.count.mockResolvedValue(0);

    await LIST_TODOS(
      makeRequest("http://localhost/api/todos?sharedWithMe=true", viewerToken)
    );

    const arg = prismaMock.todo.findMany.mock.calls[0][0] as {
      where: { userId?: unknown; shares?: unknown };
    };
    expect(arg.where.userId).toEqual({ not: "viewer" });
    expect(arg.where.shares).toEqual({ some: { userId: "viewer" } });
  });

  it("filters by assigneeId", async () => {
    prismaMock.todo.findMany.mockResolvedValue([] as never);
    prismaMock.todo.count.mockResolvedValue(0);

    await LIST_TODOS(
      makeRequest("http://localhost/api/todos?assigneeId=editor", ownerToken)
    );

    const arg = prismaMock.todo.findMany.mock.calls[0][0] as {
      where: { assigneeId?: string };
    };
    expect(arg.where.assigneeId).toBe("editor");
  });
});

describe("POST /api/todos/:id/share", () => {
  beforeEach(() => {
    prismaMock.todo.findUnique.mockResolvedValue(accessTodo() as never);
  });

  it("owner shares a todo with a user found by exact email", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "editor",
      email: "editor@example.com",
      name: null,
    } as never);
    prismaMock.todoShare.upsert.mockResolvedValue({
      id: "share-1",
      role: "EDITOR",
      todoId: "todo-1",
      userId: "editor",
      user: { id: "editor", email: "editor@example.com", name: null },
    } as never);

    const res = await CREATE_SHARE(
      makeRequest("http://localhost/api/todos/todo-1/share", ownerToken, {
        method: "POST",
        body: JSON.stringify({ email: "editor@example.com", role: "EDITOR" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "todo-1" }) }
    );

    expect(res.status).toBe(201);
    expect(prismaMock.todoShare.upsert).toHaveBeenCalledOnce();
    // The share is recorded in the activity log.
    const actions = prismaMock.activityLog.create.mock.calls.map((c) => c[0].data.action);
    expect(actions).toContain("todo.shared");
    // The invitee gets an in-app notification.
    expect(prismaMock.notification.create).toHaveBeenCalled();
  });

  it("normalizes a differently-cased invite email to match the stored account", async () => {
    // Account stored lowercased at signup; owner types the original casing.
    prismaMock.user.findUnique.mockResolvedValue({
      id: "editor",
      email: "editor@example.com",
      name: null,
    } as never);
    prismaMock.todoShare.upsert.mockResolvedValue({
      id: "share-1",
      role: "VIEWER",
      todoId: "todo-1",
      userId: "editor",
      user: { id: "editor", email: "editor@example.com", name: null },
    } as never);

    const res = await CREATE_SHARE(
      makeRequest("http://localhost/api/todos/todo-1/share", ownerToken, {
        method: "POST",
        body: JSON.stringify({ email: "Editor@Example.com" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "todo-1" }) }
    );

    expect(res.status).toBe(201);
    // The lookup is performed with the lowercased address.
    const arg = prismaMock.user.findUnique.mock.calls[0][0] as {
      where: { email: string };
    };
    expect(arg.where.email).toBe("editor@example.com");
  });

  it("returns 404 when no user matches the email", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const res = await CREATE_SHARE(
      makeRequest("http://localhost/api/todos/todo-1/share", ownerToken, {
        method: "POST",
        body: JSON.stringify({ email: "nobody@example.com" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "todo-1" }) }
    );

    expect(res.status).toBe(404);
    expect(prismaMock.todoShare.upsert).not.toHaveBeenCalled();
  });

  it("rejects sharing a todo with its owner (400)", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "owner",
      email: "owner@example.com",
      name: null,
    } as never);

    const res = await CREATE_SHARE(
      makeRequest("http://localhost/api/todos/todo-1/share", ownerToken, {
        method: "POST",
        body: JSON.stringify({ email: "owner@example.com" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "todo-1" }) }
    );

    expect(res.status).toBe(400);
  });

  it("forbids a non-owner (editor) from sharing (403)", async () => {
    prismaMock.todo.findUnique.mockResolvedValue(
      accessTodo({ shares: [{ role: "EDITOR" }] }) as never
    );

    const res = await CREATE_SHARE(
      makeRequest("http://localhost/api/todos/todo-1/share", editorToken, {
        method: "POST",
        body: JSON.stringify({ email: "someone@example.com" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "todo-1" }) }
    );

    expect(res.status).toBe(403);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });
});

describe("share role update / unshare", () => {
  beforeEach(() => {
    prismaMock.todo.findUnique.mockResolvedValue(accessTodo() as never);
  });

  it("owner updates a collaborator's role", async () => {
    prismaMock.todoShare.findUnique.mockResolvedValue({
      id: "share-1",
      role: "VIEWER",
      todoId: "todo-1",
      userId: "editor",
    } as never);
    prismaMock.todoShare.update.mockResolvedValue({
      id: "share-1",
      role: "EDITOR",
      todoId: "todo-1",
      userId: "editor",
      user: { id: "editor", email: "editor@example.com", name: null },
    } as never);

    const res = await PATCH_SHARE(
      makeRequest("http://localhost/api/todos/todo-1/share/editor", ownerToken, {
        method: "PATCH",
        body: JSON.stringify({ role: "EDITOR" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "todo-1", userId: "editor" }) }
    );

    expect(res.status).toBe(200);
    expect(prismaMock.todoShare.update).toHaveBeenCalledOnce();
  });

  it("owner unshares and clears any assignment to the removed user", async () => {
    prismaMock.todoShare.findUnique.mockResolvedValue({
      id: "share-1",
      role: "EDITOR",
      todoId: "todo-1",
      userId: "editor",
    } as never);
    prismaMock.todoShare.delete.mockResolvedValue({} as never);
    prismaMock.todo.updateMany.mockResolvedValue({ count: 0 } as never);

    const res = await DELETE_SHARE(
      makeRequest("http://localhost/api/todos/todo-1/share/editor", ownerToken, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "todo-1", userId: "editor" }) }
    );

    expect(res.status).toBe(200);
    expect(prismaMock.todoShare.delete).toHaveBeenCalledOnce();
    // Clears a dangling assignment.
    expect(prismaMock.todo.updateMany).toHaveBeenCalledWith({
      where: { id: "todo-1", assigneeId: "editor" },
      data: { assigneeId: null },
    });
  });

  it("forbids a viewer from unsharing (403)", async () => {
    prismaMock.todo.findUnique.mockResolvedValue(
      accessTodo({ shares: [{ role: "VIEWER" }] }) as never
    );

    const res = await DELETE_SHARE(
      makeRequest("http://localhost/api/todos/todo-1/share/editor", viewerToken, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "todo-1", userId: "editor" }) }
    );

    expect(res.status).toBe(403);
    expect(prismaMock.todoShare.delete).not.toHaveBeenCalled();
  });
});

describe("GET /api/users/lookup (exact email only)", () => {
  it("returns minimal public info for an exact email match", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "editor",
      email: "editor@example.com",
      name: "Ed",
    } as never);

    const res = await LOOKUP(
      makeRequest("http://localhost/api/users/lookup?email=editor@example.com", ownerToken)
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ id: "editor", email: "editor@example.com", name: "Ed" });
    // Query is a findUnique by unique email (no contains/startsWith directory scan).
    const arg = prismaMock.user.findUnique.mock.calls[0][0] as {
      where: { email: string };
      select: Record<string, boolean>;
    };
    expect(arg.where).toEqual({ email: "editor@example.com" });
    expect(arg.select).toEqual({ id: true, email: true, name: true });
  });

  it("normalizes a differently-cased query email to the lowercased lookup", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "editor",
      email: "editor@example.com",
      name: "Ed",
    } as never);

    const res = await LOOKUP(
      makeRequest("http://localhost/api/users/lookup?email=Editor@Example.com", ownerToken)
    );

    expect(res.status).toBe(200);
    const arg = prismaMock.user.findUnique.mock.calls[0][0] as {
      where: { email: string };
    };
    expect(arg.where.email).toBe("editor@example.com");
  });

  it("returns null (not self) when the email is the requesting user", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "owner",
      email: "owner@example.com",
      name: null,
    } as never);

    const res = await LOOKUP(
      makeRequest("http://localhost/api/users/lookup?email=owner@example.com", ownerToken)
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeNull();
  });

  it("rejects a non-email query (400)", async () => {
    const res = await LOOKUP(
      makeRequest("http://localhost/api/users/lookup?email=not-an-email", ownerToken)
    );
    expect(res.status).toBe(400);
  });
});

describe("assignee validation on PATCH", () => {
  it("rejects an assignee who is neither owner nor shared (400)", async () => {
    prismaMock.todo.findUnique.mockResolvedValue(accessTodo() as never);
    prismaMock.todoShare.findUnique.mockResolvedValue(null);

    const res = await PATCH_TODO(
      makeRequest("http://localhost/api/todos/todo-1", ownerToken, {
        method: "PATCH",
        body: JSON.stringify({ assigneeId: "stranger" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "todo-1" }) }
    );

    expect(res.status).toBe(400);
    expect(prismaMock.todo.update).not.toHaveBeenCalled();
  });

  it("assigns a shared user and notifies them", async () => {
    prismaMock.todo.findUnique.mockResolvedValue(accessTodo() as never);
    prismaMock.todoShare.findUnique.mockResolvedValue({ id: "share-1" } as never);
    prismaMock.todo.update.mockResolvedValue(
      accessTodo({ assigneeId: "editor" }) as never
    );

    const res = await PATCH_TODO(
      makeRequest("http://localhost/api/todos/todo-1", ownerToken, {
        method: "PATCH",
        body: JSON.stringify({ assigneeId: "editor" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "todo-1" }) }
    );

    expect(res.status).toBe(200);
    expect(prismaMock.todo.update).toHaveBeenCalledOnce();
    const actions = prismaMock.activityLog.create.mock.calls.map((c) => c[0].data.action);
    expect(actions).toContain("todo.assigned");
    expect(prismaMock.notification.create).toHaveBeenCalled();
  });
});

describe("GET /api/todos/:id/share list", () => {
  it("lists shares for a readable todo", async () => {
    prismaMock.todo.findUnique.mockResolvedValue(accessTodo() as never);
    prismaMock.todoShare.findMany.mockResolvedValue([
      { id: "s1", role: "EDITOR", todoId: "todo-1", userId: "editor", user: { id: "editor", email: "editor@example.com", name: null } },
    ] as never);

    const res = await GET_SHARES(
      makeRequest("http://localhost/api/todos/todo-1/share", ownerToken),
      { params: Promise.resolve({ id: "todo-1" }) }
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].role).toBe("EDITOR");
  });
});
