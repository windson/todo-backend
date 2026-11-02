import { describe, it, expect } from "vitest";
// Import the Prisma mock helper first so its vi.mock("@/lib/prisma") is
// registered before the route handlers load.
import { prismaMock } from "../helpers/prisma-mock";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/views/route";
import { GET as GET_ONE, PATCH, DELETE } from "@/app/api/views/[id]/route";
import { createToken } from "@/lib/auth";

const authToken = await createToken({ userId: "user-1", email: "user@example.com" });

function makeRequest(url: string, init?: RequestInit): NextRequest {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${authToken}`);
  return new NextRequest(new Request(url, { ...init, headers }));
}

function makeView(overrides: Record<string, unknown> = {}) {
  return {
    id: "view-1",
    name: "High priority",
    filters: { priority: "HIGH,URGENT", completed: "false" },
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    userId: "user-1",
    ...overrides,
  };
}

describe("GET /api/views", () => {
  it("lists the current user's saved views", async () => {
    prismaMock.savedView.findMany.mockResolvedValue([makeView()] as never);

    const res = await GET(makeRequest("http://localhost/api/views"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(prismaMock.savedView.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1" } })
    );
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await GET(new NextRequest(new Request("http://localhost/api/views")));
    expect(res.status).toBe(401);
    expect(prismaMock.savedView.findMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/views", () => {
  it("creates a saved view scoped to the user", async () => {
    prismaMock.savedView.findFirst.mockResolvedValue(null);
    prismaMock.savedView.create.mockResolvedValue(makeView() as never);

    const res = await POST(
      makeRequest("http://localhost/api/views", {
        method: "POST",
        body: JSON.stringify({
          name: "High priority",
          filters: { priority: "HIGH,URGENT", completed: "false" },
        }),
        headers: { "Content-Type": "application/json" },
      })
    );

    expect(res.status).toBe(201);
    const createArg = prismaMock.savedView.create.mock.calls[0][0];
    expect(createArg.data.userId).toBe("user-1");
  });

  it("rejects an unknown filter key (strict schema)", async () => {
    const res = await POST(
      makeRequest("http://localhost/api/views", {
        method: "POST",
        body: JSON.stringify({
          name: "Bad",
          filters: { bogus: "nope" },
        }),
        headers: { "Content-Type": "application/json" },
      })
    );

    expect(res.status).toBe(400);
    expect(prismaMock.savedView.create).not.toHaveBeenCalled();
  });

  it("rejects a missing name", async () => {
    const res = await POST(
      makeRequest("http://localhost/api/views", {
        method: "POST",
        body: JSON.stringify({ filters: {} }),
        headers: { "Content-Type": "application/json" },
      })
    );

    expect(res.status).toBe(400);
  });

  it("returns 409 on a duplicate name", async () => {
    prismaMock.savedView.findFirst.mockResolvedValue(makeView() as never);

    const res = await POST(
      makeRequest("http://localhost/api/views", {
        method: "POST",
        body: JSON.stringify({ name: "High priority", filters: {} }),
        headers: { "Content-Type": "application/json" },
      })
    );

    expect(res.status).toBe(409);
    expect(prismaMock.savedView.create).not.toHaveBeenCalled();
  });
});

describe("GET/PATCH/DELETE /api/views/:id", () => {
  it("returns a view the user owns", async () => {
    prismaMock.savedView.findFirst.mockResolvedValue(makeView() as never);

    const res = await GET_ONE(makeRequest("http://localhost/api/views/view-1"), {
      params: Promise.resolve({ id: "view-1" }),
    });

    expect(res.status).toBe(200);
    expect(prismaMock.savedView.findFirst).toHaveBeenCalledWith({
      where: { id: "view-1", userId: "user-1" },
    });
  });

  it("returns 404 fetching a view the user does not own", async () => {
    prismaMock.savedView.findFirst.mockResolvedValue(null);

    const res = await GET_ONE(makeRequest("http://localhost/api/views/other"), {
      params: Promise.resolve({ id: "other" }),
    });

    expect(res.status).toBe(404);
  });

  it("updates an owned view's filters", async () => {
    prismaMock.savedView.findFirst.mockResolvedValue(makeView() as never);
    prismaMock.savedView.update.mockResolvedValue(
      makeView({ filters: { dueFilter: "today" } }) as never
    );

    const res = await PATCH(
      makeRequest("http://localhost/api/views/view-1", {
        method: "PATCH",
        body: JSON.stringify({ filters: { dueFilter: "today" } }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "view-1" }) }
    );

    expect(res.status).toBe(200);
    expect(prismaMock.savedView.update).toHaveBeenCalledOnce();
  });

  it("returns 404 updating a view the user does not own", async () => {
    prismaMock.savedView.findFirst.mockResolvedValue(null);

    const res = await PATCH(
      makeRequest("http://localhost/api/views/other", {
        method: "PATCH",
        body: JSON.stringify({ name: "x" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "other" }) }
    );

    expect(res.status).toBe(404);
    expect(prismaMock.savedView.update).not.toHaveBeenCalled();
  });

  it("deletes an owned view", async () => {
    prismaMock.savedView.findFirst.mockResolvedValue(makeView() as never);
    prismaMock.savedView.delete.mockResolvedValue(makeView() as never);

    const res = await DELETE(
      makeRequest("http://localhost/api/views/view-1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "view-1" }) }
    );

    expect(res.status).toBe(200);
    expect(prismaMock.savedView.delete).toHaveBeenCalledWith({ where: { id: "view-1" } });
  });

  it("returns 404 deleting a view the user does not own", async () => {
    prismaMock.savedView.findFirst.mockResolvedValue(null);

    const res = await DELETE(
      makeRequest("http://localhost/api/views/other", { method: "DELETE" }),
      { params: Promise.resolve({ id: "other" }) }
    );

    expect(res.status).toBe(404);
    expect(prismaMock.savedView.delete).not.toHaveBeenCalled();
  });
});
