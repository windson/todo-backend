import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import {
  checkRateLimit,
  enforceRateLimit,
  rateLimitKey,
  getClientIp,
  type RateLimitStore,
} from "@/lib/rate-limit";

/** Fresh in-memory store per test so cases do not leak counters into each other. */
function makeStore(): RateLimitStore {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return {
    hit(key, windowMs, now) {
      const existing = windows.get(key);
      if (!existing || existing.resetAt <= now) {
        const entry = { count: 1, resetAt: now + windowMs };
        windows.set(key, entry);
        return entry;
      }
      existing.count += 1;
      return existing;
    },
    reset() {
      windows.clear();
    },
  };
}

function req(headers?: Record<string, string>): NextRequest {
  return new NextRequest(new Request("http://localhost/api/todos", { headers }));
}

describe("checkRateLimit (fixed window)", () => {
  it("allows up to the limit then blocks", () => {
    const store = makeStore();
    const opts = { limit: 3, windowMs: 1000, now: 1000, store };

    expect(checkRateLimit("k", opts).allowed).toBe(true); // 1
    expect(checkRateLimit("k", opts).allowed).toBe(true); // 2
    const third = checkRateLimit("k", opts); // 3
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);

    const fourth = checkRateLimit("k", opts); // 4 -> blocked
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
    expect(fourth.limit).toBe(3);
  });

  it("resets the counter after the window elapses", () => {
    const store = makeStore();
    const base = { limit: 1, windowMs: 1000, store };

    expect(checkRateLimit("k", { ...base, now: 1000 }).allowed).toBe(true);
    expect(checkRateLimit("k", { ...base, now: 1500 }).allowed).toBe(false);
    // After the window resets.
    expect(checkRateLimit("k", { ...base, now: 2500 }).allowed).toBe(true);
  });

  it("tracks keys independently", () => {
    const store = makeStore();
    const opts = { limit: 1, windowMs: 1000, now: 1000, store };
    expect(checkRateLimit("a", opts).allowed).toBe(true);
    expect(checkRateLimit("b", opts).allowed).toBe(true);
    expect(checkRateLimit("a", opts).allowed).toBe(false);
  });
});

describe("rateLimitKey / getClientIp", () => {
  it("prefers the user id when known", () => {
    expect(rateLimitKey(req(), "user-1")).toBe("user:user-1");
  });

  it("falls back to the client IP from X-Forwarded-For", () => {
    const r = req({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" });
    expect(getClientIp(r)).toBe("203.0.113.5");
    expect(rateLimitKey(r)).toBe("ip:203.0.113.5");
  });
});

describe("enforceRateLimit", () => {
  it("is a no-op when rate limiting is disabled", () => {
    delete process.env.RATE_LIMIT_ENABLED;
    expect(enforceRateLimit(req(), "user-1", { store: makeStore() })).toBeNull();
  });

  it("returns a 429 envelope with Retry-After once the limit is exceeded", () => {
    process.env.RATE_LIMIT_ENABLED = "true";
    const store = makeStore();
    const opts = { limit: 1, windowMs: 60_000, store };

    // First request is allowed.
    expect(enforceRateLimit(req(), "user-1", opts)).toBeNull();
    // Second request is blocked.
    const blocked = enforceRateLimit(req(), "user-1", opts);
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);
    expect(blocked!.headers["Retry-After"]).toBeDefined();
    expect(blocked!.headers["X-RateLimit-Limit"]).toBe("1");

    const body = JSON.parse(blocked!.body);
    expect(body.success).toBe(false);
    expect(body.error.message).toMatch(/too many requests/i);

    delete process.env.RATE_LIMIT_ENABLED;
  });
});
