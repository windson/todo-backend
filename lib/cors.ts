import type { NextRequest } from "next/server";

const LOCAL_ORIGINS = ["http://localhost:5173", "http://localhost:3000"];

/** Parse a comma separated origin list: trims entries, strips trailing slashes. */
export function parseOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

/**
 * Credentialed-CORS allow-list. Localhost dev origins are dropped in
 * production so a page served from a victim's own machine is never trusted.
 */
export function buildAllowedOrigins(
  corsEnv: string | undefined,
  nodeEnv: string | undefined,
): string[] {
  const local = nodeEnv === "production" ? [] : LOCAL_ORIGINS;
  return [...local, ...parseOrigins(corsEnv)];
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// Content types a cross-site HTML form cannot produce (forms are limited to
// urlencoded, multipart and text/plain), so they imply a CORS preflight.
const SAFE_CONTENT_TYPES = ["application/json", "text/csv"];

/**
 * CSRF defence for cookie-authenticated unsafe requests (needed because the
 * session cookie may be SameSite=None). Returns an error message when the
 * request must be rejected with 403, otherwise null.
 *  1. If an Origin header is present it must be in the allow-list.
 *  2. A request declaring a content type must be JSON/CSV, or send the custom
 *     X-Requested-With header (which also forces a preflight cross-site).
 */
export function csrfViolation(
  request: NextRequest,
  allowedOrigins: string[],
): string | null {
  if (!UNSAFE_METHODS.has(request.method)) return null;

  const origin = request.headers.get("origin");
  if (origin !== null && !allowedOrigins.includes(origin)) {
    return "Cross-origin request not allowed";
  }

  if (request.headers.get("x-requested-with")) return null;
  // Browsers always label form bodies, so judge by the declared content type.
  // Requests without one (non-browser clients, body-less calls) pass.
  const contentType = request.headers.get("content-type")?.toLowerCase();
  if (contentType && !SAFE_CONTENT_TYPES.some((t) => contentType.startsWith(t))) {
    return "Unsupported content type";
  }
  return null;
}
