import { describe, it, expect, beforeEach } from "vitest";
import { prismaMock } from "../helpers/prisma-mock";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/import/route";
import { GET as EXPORT } from "@/app/api/export/route";
import { createToken } from "@/lib/auth";

const authToken = await createToken({
  userId: "user-1",
  email: "user@example.com",
});

function makeRequest(url: string, init?: RequestInit): NextRequest {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${authToken}`);
  return new NextRequest(new Request(url, { ...init, headers }));
}

describe("POST /api/import", () => {
  beforeEach(() => {
    // Default: no existing categories/tags (everything is created fresh).
    prismaMock.category.findFirst.mockResolvedValue(null as never);
    prismaMock.tag.findFirst.mockResolvedValue(null as never);
    prismaMock.category.create.mockResolvedValue({ id: "cat-new" } as never);
    prismaMock.tag.create.mockResolvedValue({ id: "tag-new" } as never);
    prismaMock.todo.create.mockResolvedValue({ id: "todo-new" } as never);
  });

  it("imports a JSON bundle and returns a created summary", async () => {
    const bundle = {
      categories: [{ name: "Work", color: "#112233" }],
      tags: [{ name: "urgent", color: "#445566" }],
      todos: [
        { title: "First", category: "Work", tags: ["urgent"] },
        { title: "Second", completed: true, priority: "HIGH" },
      ],
    };

    const res = await POST(
      makeRequest("http://localhost/api/import", {
        method: "POST",
        body: JSON.stringify(bundle),
        headers: { "Content-Type": "application/json" },
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.created.categories).toBe(1);
    expect(body.data.created.tags).toBe(1);
    expect(body.data.created.todos).toBe(2);
    expect(body.data.errors).toEqual([]);

    // Every created todo is scoped to the authenticated user, never a userId
    // from the payload.
    const createCalls = prismaMock.todo.create.mock.calls;
    expect(createCalls).toHaveLength(2);
    for (const [arg] of createCalls) {
      expect((arg as { data: { userId: string } }).data.userId).toBe("user-1");
    }
  });

  it("reuses an existing category by name instead of creating a duplicate", async () => {
    prismaMock.category.findFirst.mockResolvedValue({ id: "cat-existing" } as never);

    const res = await POST(
      makeRequest("http://localhost/api/import", {
        method: "POST",
        body: JSON.stringify({ todos: [{ title: "T", category: "Work" }] }),
        headers: { "Content-Type": "application/json" },
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.reused.categories).toBe(1);
    expect(body.data.created.categories).toBe(0);
    expect(prismaMock.category.create).not.toHaveBeenCalled();
  });

  it("ignores a userId field in the payload (cannot write to another user)", async () => {
    const res = await POST(
      makeRequest("http://localhost/api/import", {
        method: "POST",
        body: JSON.stringify({
          todos: [{ title: "Sneaky", userId: "other-user" }],
        }),
        headers: { "Content-Type": "application/json" },
      })
    );

    expect(res.status).toBe(200);
    const [arg] = prismaMock.todo.create.mock.calls[0];
    const data = (arg as { data: Record<string, unknown> }).data;
    expect(data.userId).toBe("user-1");
    expect(data).not.toHaveProperty("other-user");
  });

  it("returns a 400 with messages for an invalid bundle", async () => {
    const res = await POST(
      makeRequest("http://localhost/api/import", {
        method: "POST",
        // title is required; empty string fails validation.
        body: JSON.stringify({ todos: [{ title: "" }] }),
        headers: { "Content-Type": "application/json" },
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.message).toBe("Import validation failed");
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(prismaMock.todo.create).not.toHaveBeenCalled();
  });

  it("imports a CSV body via ?format=csv", async () => {
    const csv =
      'title,description,completed,priority,startDate,dueDate,category,tags\r\n' +
      'Buy milk,"2%, skim",false,LOW,,,Groceries,"shopping, home"\r\n';

    const res = await POST(
      makeRequest("http://localhost/api/import?format=csv", {
        method: "POST",
        body: csv,
        headers: { "Content-Type": "text/csv" },
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.created.todos).toBe(1);
    // Two distinct tags were parsed from the quoted field.
    expect(prismaMock.tag.create).toHaveBeenCalledTimes(2);
  });

  it("returns a 401 when unauthenticated", async () => {
    const res = await POST(
      new NextRequest(
        new Request("http://localhost/api/import", {
          method: "POST",
          body: JSON.stringify({ todos: [] }),
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    expect(res.status).toBe(401);
  });
});

describe("GET /api/export", () => {
  beforeEach(() => {
    prismaMock.category.findMany.mockResolvedValue([
      { name: "Work", color: "#112233" },
    ] as never);
    prismaMock.tag.findMany.mockResolvedValue([
      { name: "urgent", color: "#445566" },
    ] as never);
    prismaMock.todo.findMany.mockResolvedValue([
      {
        title: "Buy milk",
        description: "2%, skim",
        completed: false,
        priority: "LOW",
        startDate: null,
        dueDate: null,
        category: { name: "Groceries" },
        tags: [{ tag: { name: "shopping" } }, { tag: { name: "home" } }],
      },
    ] as never);
  });

  it("exports a JSON bundle as an attachment", async () => {
    const res = await EXPORT(makeRequest("http://localhost/api/export"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("content-disposition")).toContain("attachment");

    const bundle = JSON.parse(await res.text());
    expect(bundle.version).toBe(1);
    expect(bundle.categories).toEqual([{ name: "Work", color: "#112233" }]);
    expect(bundle.todos[0].title).toBe("Buy milk");
    expect(bundle.todos[0].tags).toEqual(["shopping", "home"]);
    // Export is owned-only: scoped by userId.
    const [arg] = prismaMock.todo.findMany.mock.calls[0];
    expect((arg as { where: { userId: string } }).where.userId).toBe("user-1");
  });

  it("exports CSV when format=csv", async () => {
    const res = await EXPORT(
      makeRequest("http://localhost/api/export?format=csv")
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");

    const csv = await res.text();
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe(
      "title,description,completed,priority,startDate,dueDate,category,tags"
    );
    // The description with a comma is quoted; tags are a joined quoted field.
    expect(lines[1]).toContain('"2%, skim"');
    expect(lines[1]).toContain('"shopping, home"');
  });
});
