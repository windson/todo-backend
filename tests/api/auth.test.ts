import { describe, it, expect, vi, beforeEach } from "vitest";
// Register the Prisma module mock before importing the route handlers.
import { prismaMock } from "../helpers/prisma-mock";

// cookies() requires a request scope that is not available under the Vitest
// node environment, so stub next/headers with an in-memory cookie store.
const cookieStore = { set: vi.fn() };
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
}));

import { NextRequest } from "next/server";
import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as login } from "@/app/api/auth/login/route";
import { hashPassword } from "@/lib/auth";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(
    new Request("http://localhost/api/auth", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    })
  );
}

beforeEach(() => {
  cookieStore.set.mockReset();
});

describe("POST /api/auth/signup", () => {
  it("creates a user, sets a session cookie, and returns 201", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null as never);
    prismaMock.user.create.mockResolvedValue({
      id: "user-1",
      email: "new@example.com",
      name: "New User",
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
    } as never);

    const res = await signup(
      makeRequest({ email: "New@Example.com", password: "password123", name: "New User" })
    );

    expect(res.status).toBe(201);
    const payload = await res.json();
    expect(payload.success).toBe(true);
    expect(payload.data.email).toBe("new@example.com");
    expect(cookieStore.set).toHaveBeenCalledOnce();
    // Email should be normalized to lowercase before persistence.
    expect(prismaMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: "new@example.com" }),
      })
    );
  });

  it("rejects an invalid email with a 400", async () => {
    const res = await signup(makeRequest({ email: "not-an-email", password: "password123" }));
    expect(res.status).toBe(400);
    const payload = await res.json();
    expect(payload.success).toBe(false);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("rejects a short password with a 400", async () => {
    const res = await signup(makeRequest({ email: "a@b.com", password: "short" }));
    expect(res.status).toBe(400);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("returns 409 when the email is already registered", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "existing" } as never);
    const res = await signup(makeRequest({ email: "dupe@example.com", password: "password123" }));
    expect(res.status).toBe(409);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/login", () => {
  it("logs in with valid credentials and sets a session cookie", async () => {
    const passwordHash = await hashPassword("password123");
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-2",
      email: "user@example.com",
      name: null,
      passwordHash,
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
    } as never);

    const res = await login(makeRequest({ email: "user@example.com", password: "password123" }));

    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.success).toBe(true);
    expect(payload.data.id).toBe("user-2");
    expect(cookieStore.set).toHaveBeenCalledOnce();
  });

  it("returns 401 for an unknown email", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null as never);
    const res = await login(makeRequest({ email: "nobody@example.com", password: "password123" }));
    expect(res.status).toBe(401);
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("returns 401 for a wrong password", async () => {
    const passwordHash = await hashPassword("correct-password");
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-3",
      email: "user@example.com",
      name: null,
      passwordHash,
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
    } as never);

    const res = await login(makeRequest({ email: "user@example.com", password: "wrong-password" }));
    expect(res.status).toBe(401);
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("returns 400 when fields are missing", async () => {
    const res = await login(makeRequest({ email: "user@example.com" }));
    expect(res.status).toBe(400);
  });
});
