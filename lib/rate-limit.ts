import type { NextRequest } from "next/server";

/**
 * In-memory fixed-window rate limiter.
 *
 * SCOPE / PRODUCTION CAVEAT: the counters live in a module-level Map, so they
 * are per-process. On a single instance (e.g. local dev, a single container)
 * this is correct; across multiple instances or serverless workers each process
 * keeps its own window, so the effective limit is multiplied by the number of
 * instances. For a real multi-instance deployment, swap `defaultStore` for a
 * shared store (Redis, Upstash, etc.) that implements the same `RateLimitStore`
 * interface. This is deliberately pluggable via `checkRateLimit(..., store)`.
 *
 * Algorithm: fixed window. Each key gets a counter that resets every
 * `windowMs`. The first hit in a window records `resetAt = now + windowMs`;
 * subsequent hits increment until `limit` is exceeded.
 *
 * NOTE: this runs from route handlers (Node runtime), NOT from Edge middleware,
 * so a plain Map is fine. Rate limiting was intentionally placed in a shared
 * wrapper invoked by handlers rather than in middleware.ts, because the Edge
 * middleware runtime discourages mutable module-level state and the limiter
 * needs the resolved user id (which the handlers already compute via
 * requireUser).
 */

export interface RateLimitResult {
  /** Whether the request is allowed (under the limit). */
  allowed: boolean;
  /** The configured maximum number of requests per window. */
  limit: number;
  /** Requests remaining in the current window (never negative). */
  remaining: number;
  /** Epoch milliseconds when the current window resets. */
  resetAt: number;
  /** Seconds until the window resets (for a Retry-After header). */
  retryAfterSeconds: number;
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitStore {
  /** Increment the counter for `key`, (re)starting a window of `windowMs`. */
  hit(key: string, windowMs: number, now: number): WindowEntry;
  /** Remove all counters (used by tests to reset between cases). */
  reset(): void;
}

/** Default per-process in-memory store. */
class InMemoryRateLimitStore implements RateLimitStore {
  private windows = new Map<string, WindowEntry>();

  hit(key: string, windowMs: number, now: number): WindowEntry {
    const existing = this.windows.get(key);
    if (!existing || existing.resetAt <= now) {
      const entry: WindowEntry = { count: 1, resetAt: now + windowMs };
      this.windows.set(key, entry);
      return entry;
    }
    existing.count += 1;
    return existing;
  }

  reset(): void {
    this.windows.clear();
  }
}

export const defaultStore: RateLimitStore = new InMemoryRateLimitStore();

/**
 * Whether rate limiting is enabled. Disabled by default so the existing test
 * suite (which fires many requests) is unaffected; enable with
 * RATE_LIMIT_ENABLED=true. Production should enable it.
 */
export function isRateLimitEnabled(): boolean {
  return process.env.RATE_LIMIT_ENABLED === "true";
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Window length in milliseconds (default 60s). Configurable via env. */
export function getWindowMs(): number {
  return envInt("RATE_LIMIT_WINDOW_MS", 60_000);
}

/** Max requests per window (default 100). Configurable via env. */
export function getMaxRequests(): number {
  return envInt("RATE_LIMIT_MAX", 100);
}

/**
 * Derive a client IP from proxy headers. Best-effort: behind a proxy the
 * left-most X-Forwarded-For entry is the originating client.
 */
export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

/**
 * Build the rate-limit key for a request. Prefers the authenticated user id so
 * a logged-in principal is limited consistently across IPs; falls back to the
 * client IP for unauthenticated requests.
 */
export function rateLimitKey(request: NextRequest, userId?: string): string {
  return userId ? `user:${userId}` : `ip:${getClientIp(request)}`;
}

/**
 * Check (and record) a single request against the limiter. Returns the result;
 * the caller decides whether to reject with 429. Safe paths that should be
 * exempt (or use a higher limit) are handled by the caller choosing whether to
 * call this at all.
 */
export function checkRateLimit(
  key: string,
  options?: { limit?: number; windowMs?: number; now?: number; store?: RateLimitStore }
): RateLimitResult {
  const limit = options?.limit ?? getMaxRequests();
  const windowMs = options?.windowMs ?? getWindowMs();
  const now = options?.now ?? Date.now();
  const store = options?.store ?? defaultStore;

  const entry = store.hit(key, windowMs, now);
  const remaining = Math.max(0, limit - entry.count);
  const allowed = entry.count <= limit;

  return {
    allowed,
    limit,
    remaining,
    resetAt: entry.resetAt,
    retryAfterSeconds: Math.max(0, Math.ceil((entry.resetAt - now) / 1000)),
  };
}

/**
 * Apply rate limiting for a request keyed by the (optional) authenticated user
 * id. Returns a 429 error-envelope Response when the limit is exceeded, or null
 * when the request may proceed. A no-op (returns null) when rate limiting is
 * disabled, so the existing test suite is unaffected unless RATE_LIMIT_ENABLED
 * is set.
 *
 * Call this near the top of a route handler, after resolving the user:
 *   const limited = enforceRateLimit(request, userId);
 *   if (limited) return limited;
 */
export function enforceRateLimit(
  request: NextRequest,
  userId?: string,
  options?: { limit?: number; windowMs?: number; store?: RateLimitStore }
) {
  if (!isRateLimitEnabled()) return null;

  const result = checkRateLimit(rateLimitKey(request, userId), options);
  if (result.allowed) return null;

  // 429 with the standard error envelope plus the conventional rate-limit
  // headers. Returned as plain {status, headers, body} so the caller (a route
  // handler or middleware) can construct the Response/NextResponse it needs.
  const body = JSON.stringify({
    success: false as const,
    error: {
      message: "Too many requests. Please slow down and try again shortly.",
    },
  });
  return {
    status: 429 as const,
    body,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(result.retryAfterSeconds),
      "X-RateLimit-Limit": String(result.limit),
      "X-RateLimit-Remaining": String(result.remaining),
      "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
    } as Record<string, string>,
  };
}
