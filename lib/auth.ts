import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import type { NextRequest } from "next/server";
import { ApiError } from "./errors";

/**
 * Name of the httpOnly cookie that carries the session JWT.
 */
export const AUTH_COOKIE_NAME = "token";

/**
 * Session lifetime in seconds (7 days). Shared between the JWT `exp` claim and
 * the cookie `maxAge` so they expire together.
 */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

const BCRYPT_ROUNDS = 10;

/**
 * Dev-only fallback secret. Used solely when JWT_SECRET is unset outside of
 * production so the build and test suite stay green without configuration.
 */
const DEV_SECRET = "dev-insecure-secret-change-me-in-production";

/**
 * Secret used to sign/verify session tokens. In production a missing
 * JWT_SECRET fails loudly rather than silently signing tokens with the
 * publicly-known dev default; outside production the dev default keeps the
 * build and tests green without secrets.
 */
function getSecret(): Uint8Array {
  const configured = process.env.JWT_SECRET;
  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "JWT_SECRET must be set in production. Refusing to sign session tokens with the insecure dev default."
      );
    }
    return new TextEncoder().encode(DEV_SECRET);
  }
  return new TextEncoder().encode(configured);
}

export interface AuthTokenPayload {
  userId: string;
  email: string;
}

/** Hash a plaintext password for storage. */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/** Verify a plaintext password against a stored bcrypt hash. */
export async function verifyPassword(
  password: string,
  passwordHash: string
): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

/** Issue a signed session JWT for the given user. */
export async function createToken(payload: AuthTokenPayload): Promise<string> {
  return new SignJWT({ email: payload.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(getSecret());
}

/**
 * Verify a session JWT and return its payload, or null when the token is
 * missing, malformed, expired, or signed with a different secret.
 */
export async function verifyToken(
  token: string
): Promise<AuthTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.sub !== "string" || typeof payload.email !== "string") {
      return null;
    }
    return { userId: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}

/**
 * Extract the session token from a request. Prefers the httpOnly cookie but
 * also accepts a `Bearer` Authorization header for API clients.
 */
export function getTokenFromRequest(request: NextRequest): string | null {
  const cookieToken = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (cookieToken) return cookieToken;

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim() || null;
  }

  return null;
}

/**
 * Resolve the authenticated user for a request, or null when the request is
 * unauthenticated or the token is invalid.
 */
export async function getCurrentUser(
  request: NextRequest
): Promise<AuthTokenPayload | null> {
  const token = getTokenFromRequest(request);
  if (!token) return null;
  return verifyToken(token);
}

/**
 * Resolve the authenticated user for a protected route handler, throwing
 * ApiError.unauthorized() when the request is not authenticated. Use at the top
 * of handlers that require a logged-in user.
 */
export async function requireUser(
  request: NextRequest
): Promise<AuthTokenPayload> {
  const user = await getCurrentUser(request);
  if (!user) {
    throw ApiError.unauthorized();
  }
  return user;
}

/**
 * Header a scheduler/cron presents to call the reminder dispatch endpoint
 * without a user session.
 */
export const DISPATCH_SECRET_HEADER = "x-dispatch-secret";

/**
 * Whether a request carries a valid reminder-dispatch shared secret. Used to
 * let an external scheduler/cron trigger /api/reminders/dispatch without a user
 * session. Returns false when REMINDER_DISPATCH_SECRET is unset so the endpoint
 * stays protected by the normal auth guard by default.
 */
export function hasValidDispatchSecret(request: NextRequest): boolean {
  const configured = process.env.REMINDER_DISPATCH_SECRET;
  if (!configured) return false;
  const provided = request.headers.get(DISPATCH_SECRET_HEADER);
  return Boolean(provided) && provided === configured;
}

/** Cookie options for the session cookie, shared by login/signup/logout. */
export function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}
