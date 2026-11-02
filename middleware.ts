import { NextRequest, NextResponse } from "next/server";
import { getTokenFromRequest, verifyToken, hasValidDispatchSecret } from "@/lib/auth";

const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
];

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
  response.headers.set("Access-Control-Expose-Headers", "X-Total-Count");
  return response;
}

export async function middleware(request: NextRequest) {
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
    return response;
  }

  const { pathname } = request.nextUrl;

  // Enforce authentication on protected API routes. /api/auth/* and /api/doc
  // remain public.
  // The reminder dispatch endpoint is normally behind the user auth guard, but
  // an external scheduler/cron can also authenticate with a shared secret
  // header (REMINDER_DISPATCH_SECRET). This does NOT open other routes: only
  // this exact path is allowed through, and only with a matching secret.
  const isDispatchWithSecret =
    pathname === "/api/reminders/dispatch" && hasValidDispatchSecret(request);

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
      return applyCors(response, origin, isAllowedOrigin);
    }
  }

  // Handle actual requests
  const response = NextResponse.next();
  return applyCors(response, origin, isAllowedOrigin);
}

export const config = {
  matcher: "/api/:path*",
};
