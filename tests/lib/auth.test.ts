import { describe, it, expect, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  hashPassword,
  verifyPassword,
  createToken,
  verifyToken,
  getTokenFromRequest,
  getCurrentUser,
  sessionCookieOptions,
  AUTH_COOKIE_NAME,
} from "@/lib/auth";

describe("password hashing", () => {
  it("hashes a password to a value that is not the plaintext", async () => {
    const hash = await hashPassword("s3cret-password");
    expect(hash).not.toBe("s3cret-password");
    expect(hash.length).toBeGreaterThan(0);
  });

  it("verifies a correct password and rejects an incorrect one", async () => {
    const hash = await hashPassword("s3cret-password");
    expect(await verifyPassword("s3cret-password", hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });
});

describe("session tokens", () => {
  it("round-trips a token payload", async () => {
    const token = await createToken({ userId: "user-1", email: "a@b.com" });
    const payload = await verifyToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.userId).toBe("user-1");
    expect(payload?.email).toBe("a@b.com");
  });

  it("returns null for a malformed token", async () => {
    expect(await verifyToken("not-a-real-token")).toBeNull();
  });
});

describe("JWT secret resolution", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSecret = process.env.JWT_SECRET;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete (process.env as Record<string, string | undefined>).NODE_ENV;
    } else {
      (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
    }
    if (originalSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalSecret;
    }
  });

  it("fails loudly in production when JWT_SECRET is unset", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete process.env.JWT_SECRET;
    await expect(
      createToken({ userId: "user-1", email: "a@b.com" })
    ).rejects.toThrow(/JWT_SECRET must be set in production/);
  });

  it("uses the configured secret in production when JWT_SECRET is set", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.JWT_SECRET = "a-real-production-secret";
    const token = await createToken({ userId: "user-1", email: "a@b.com" });
    expect(await verifyToken(token)).not.toBeNull();
  });

  it("falls back to the dev default outside production (build/tests stay green)", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    delete process.env.JWT_SECRET;
    const token = await createToken({ userId: "user-1", email: "a@b.com" });
    expect(await verifyToken(token)).not.toBeNull();
  });
});

describe("request token extraction", () => {
  it("reads the token from the Authorization bearer header", () => {
    const request = new NextRequest(
      new Request("http://localhost/api/todos", {
        headers: { authorization: "Bearer abc.def.ghi" },
      })
    );
    expect(getTokenFromRequest(request)).toBe("abc.def.ghi");
  });

  it("reads the token from the session cookie", () => {
    const request = new NextRequest(
      new Request("http://localhost/api/todos", {
        headers: { cookie: `${AUTH_COOKIE_NAME}=cookie-token-value` },
      })
    );
    expect(getTokenFromRequest(request)).toBe("cookie-token-value");
  });

  it("returns null when no token is present", () => {
    const request = new NextRequest(new Request("http://localhost/api/todos"));
    expect(getTokenFromRequest(request)).toBeNull();
  });

  it("getCurrentUser resolves a user from a valid bearer token", async () => {
    const token = await createToken({ userId: "user-9", email: "u@b.com" });
    const request = new NextRequest(
      new Request("http://localhost/api/todos", {
        headers: { authorization: `Bearer ${token}` },
      })
    );
    const user = await getCurrentUser(request);
    expect(user?.userId).toBe("user-9");
  });

  it("getCurrentUser returns null for an unauthenticated request", async () => {
    const request = new NextRequest(new Request("http://localhost/api/todos"));
    expect(await getCurrentUser(request)).toBeNull();
  });
});

describe("sessionCookieOptions", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses SameSite=Lax by default", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CORS_ALLOWED_ORIGINS", "");
    expect(sessionCookieOptions(10)).toMatchObject({ sameSite: "lax", secure: true });
  });

  it("uses SameSite=None; Secure when a cross-site SPA origin is configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CORS_ALLOWED_ORIGINS", "https://spa.example.com");
    expect(sessionCookieOptions(10)).toMatchObject({ sameSite: "none", secure: true });
  });
});
