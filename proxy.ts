import { NextRequest, NextResponse } from "next/server";
import { getTokenFromRequest, verifyToken, hasValidDispatchSecret } from "@/lib/auth";
import {
  enforceRateLimit,
  isRateLimitEnabled,
} from "@/lib/rate-limit";
import { logRequest, isRequestLogEnabled } from "@/lib/request-log";

// Extra browser origins (comma separated) allowed to call the API with
// credentials, e.g. a separately hosted SPA. Set via CORS_ALLOWED_ORIGINS.
function parseOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  ...parseOrigins(process.env.CORS_ALLOWED_ORIGINS),
];

// Paths exempt from rate limiting (or that must never be locked out): the auth
// bootstrap endpoints a freshly-loaded client hammers, and the OpenAPI doc.
// These stay reachable even under heavy load so a user can always sign in and
// the app can bootstrap its session.
const RATE_LIMIT_EXEMPT_PREFIXES = ["/api/auth", "/api/doc"];

function isRateLimitExempt(pathname: string): boolean {
  return RATE_LIMIT_EXEMPT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

// Routes under /api that do NOT require authentication.
const PUBLIC_API_PREFIXES = ["/api/auth", "/api/doc"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function applyCors(response: NextResponse, origin: string, isAllowedOrigin: boolean) {
  if (isAllowedOrigin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
  }
  response.headers.set("Access-Control-Allow-Credentials", "true");
  response.headers.append("Vary", "Origin");
  // Expose pagination (X-Total-Count + RFC 5988 Link) and rate-limit headers to
  // browser clients, which otherwise cannot read non-simple response headers.
  response.headers.set(
    "Access-Control-Expose-Headers",
    "X-Total-Count, Link, Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset"
  );
  return response;
}

export async function proxy(request: NextRequest) {
  const origin = request.headers.get("origin") ?? "";
  const isAllowedOrigin = ALLOWED_ORIGINS.includes(origin);

  // Handle preflight (OPTIONS) requests
  if (request.method === "OPTIONS") {
    const response = new NextResponse(null, { status: 204 });
    if (isAllowedOrigin) {
      response.headers.set("Access-Control-Allow-Origin", origin);
    }
    response.headers.set(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    );
    response.headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Requested-With"
    );
    response.headers.set("Access-Control-Allow-Credentials", "true");
    response.headers.set("Access-Control-Max-Age", "86400");
    response.headers.append("Vary", "Origin");
    return response;
  }

  const { pathname } = request.nextUrl;
  const startedAt = Date.now();

  // Log a completed request handled (or rejected) by middleware itself. For
  // requests middleware forwards to a route handler, the handler's status is
  // not visible here, so middleware only logs the responses it produces (auth
  // 401, rate-limit 429); the route handlers log their own outcomes via
  // lib/request-log. This keeps every log line accurate.
  const logFromMiddleware = (status: number, userId: string | null) => {
    if (!isRequestLogEnabled()) return;
    logRequest({
      method: request.method,
      path: pathname,
      status,
      durationMs: Math.round(Date.now() - startedAt),
      userId,
    });
  };

  // Enforce authentication on protected API routes. /api/auth/* and /api/doc
  // remain public.
  // The reminder dispatch endpoint is normally behind the user auth guard, but
  // an external scheduler/cron can also authenticate with a shared secret
  // header (REMINDER_DISPATCH_SECRET). This does NOT open other routes: only
  // this exact path is allowed through, and only with a matching secret.
  const isDispatchWithSecret =
    pathname === "/api/reminders/dispatch" && hasValidDispatchSecret(request);

  let resolvedUserId: string | null = null;

  if (!isPublicPath(pathname) && !isDispatchWithSecret) {
    const token = getTokenFromRequest(request);
    const user = token ? await verifyToken(token) : null;
    if (!user) {
      const response = NextResponse.json(
        {
          success: false,
          error: { message: "Authentication required" },
        },
        { status: 401 }
      );
      logFromMiddleware(401, null);
      return applyCors(response, origin, isAllowedOrigin);
    }
    resolvedUserId = user.userId;
  }

  // Rate limiting (global, applied here so every protected route is covered
  // uniformly). Keyed by the authenticated user id when known, else the client
  // IP. Disabled by default (RATE_LIMIT_ENABLED) so the test suite is
  // unaffected; exempt the auth-bootstrap and doc paths so a client can always
  // sign in. SINGLE-INSTANCE CAVEAT: the limiter uses an in-process Map, which
  // is correct on one instance only - a multi-instance/serverless deployment
  // must swap in a shared store (see lib/rate-limit.ts).
  if (isRateLimitEnabled() && !isRateLimitExempt(pathname)) {
    const limited = enforceRateLimit(request, resolvedUserId ?? undefined);
    if (limited) {
      const response = new NextResponse(limited.body, {
        status: limited.status,
        headers: limited.headers,
      });
      logFromMiddleware(429, resolvedUserId);
      return applyCors(response, origin, isAllowedOrigin);
    }
  }

  // Forward to the route handler. Its status is logged by the handler itself.
  const response = NextResponse.next();
  return applyCors(response, origin, isAllowedOrigin);
}

export const config = {
  matcher: "/api/:path*",
};
