import { describe, it, expect } from "vitest";
import { prismaMock } from "../helpers/prisma-mock";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/notifications/route";
import { PATCH } from "@/app/api/notifications/[id]/route";
import { createToken } from "@/lib/auth";

const authToken = await createToken({ userId: "user-1", email: "user@example.com" });

function makeRequest(url: string, init?: RequestInit): NextRequest {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${authToken}`);
  return new NextRequest(new Request(url, { ...init, headers }));
}

function makeNotification(overrides: Record<string, unknown> = {}) {
  return {
    id: "notif-1",
    type: "reminder.due",
    payload: { todoId: "todo-1", todoTitle: "Launch" },
    read: false,
    userId: "user-1",
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("GET /api/notifications", () => {
  it("returns the user's notifications with an X-Total-Count header", async () => {
    prismaMock.notification.findMany.mockResolvedValue([makeNotification()] as never);
    prismaMock.notification.count.mockResolvedValue(1 as never);

    const res = await GET(makeRequest("http://localhost/api/notifications"));

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Total-Count")).toBe("1");
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    const whereArg = prismaMock.notification.findMany.mock.calls[0][0];
    expect(whereArg.where).toEqual({ userId: "user-1" });
  });

  it("filters to unread when read=false is passed", async () => {
    prismaMock.notification.findMany.mockResolvedValue([makeNotification()] as never);
    prismaMock.notification.count.mockResolvedValue(1 as never);

    await GET(makeRequest("http://localhost/api/notifications?read=false"));

    const whereArg = prismaMock.notification.findMany.mock.calls[0][0];
    expect(whereArg.where).toEqual({ userId: "user-1", read: false });
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await GET(
      new NextRequest(new Request("http://localhost/api/notifications"))
    );
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/notifications/:id", () => {
  it("marks a notification read by default", async () => {
    prismaMock.notification.findFirst.mockResolvedValue(makeNotification() as never);
    prismaMock.notification.update.mockResolvedValue(makeNotification({ read: true }) as never);

    const res = await PATCH(
      makeRequest("http://localhost/api/notifications/notif-1", { method: "PATCH" }),
      { params: Promise.resolve({ id: "notif-1" }) }
    );

    expect(res.status).toBe(200);
    const updateArg = prismaMock.notification.update.mock.calls[0][0];
    expect(updateArg.data).toEqual({ read: true });
  });

  it("can mark a notification unread via body", async () => {
    prismaMock.notification.findFirst.mockResolvedValue(makeNotification({ read: true }) as never);
    prismaMock.notification.update.mockResolvedValue(makeNotification({ read: false }) as never);

    const res = await PATCH(
      makeRequest("http://localhost/api/notifications/notif-1", {
        method: "PATCH",
        body: JSON.stringify({ read: false }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "notif-1" }) }
    );

    expect(res.status).toBe(200);
    const updateArg = prismaMock.notification.update.mock.calls[0][0];
    expect(updateArg.data).toEqual({ read: false });
  });

  it("returns 404 for a notification the user does not own", async () => {
    prismaMock.notification.findFirst.mockResolvedValue(null);

    const res = await PATCH(
      makeRequest("http://localhost/api/notifications/other", { method: "PATCH" }),
      { params: Promise.resolve({ id: "other" }) }
    );

    expect(res.status).toBe(404);
    expect(prismaMock.notification.update).not.toHaveBeenCalled();
  });
});
