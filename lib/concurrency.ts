import type { NextRequest } from "next/server";
import { ApiError } from "./errors";

/**
 * Optimistic concurrency control for conditional updates.
 *
 * A client that wants to avoid clobbering a concurrent edit presents the
 * version of the record it last saw. The server compares that to the record's
 * current `updatedAt` and returns 409 (ApiError.conflict) if the record has
 * changed since.
 *
 * BACKWARD COMPATIBLE: if the client sends NO token (no header and no field),
 * the check is skipped and the PATCH behaves exactly as before. Concurrency is
 * only enforced when a token is supplied.
 *
 * Two token forms are accepted, in priority order:
 *  1. The `If-Unmodified-Since` HTTP header (an HTTP-date). Standard, but only
 *     has second precision.
 *  2. An `expectedUpdatedAt` field in the request body (ISO date-time string or
 *     epoch ms). Millisecond precision; preferred by the frontend.
 */

export const IF_UNMODIFIED_SINCE_HEADER = "if-unmodified-since";

/** Parse an expected-version token into epoch milliseconds, or null. */
function toEpochMs(value: unknown): number | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/**
 * Resolve the expected-version token for a request from the body field or the
 * If-Unmodified-Since header. Returns the token as epoch ms, or null when the
 * client supplied none (meaning: skip the check).
 *
 * Throws ApiError.badRequest when a token IS supplied but cannot be parsed, so
 * a malformed token is a client error rather than a silent no-op.
 */
export function resolveExpectedVersion(
  request: NextRequest,
  body: Record<string, unknown> | null | undefined
): number | null {
  const field = body?.expectedUpdatedAt;
  if (field !== undefined) {
    const ms = toEpochMs(field);
    if (ms === null) {
      throw ApiError.badRequest("expectedUpdatedAt must be a valid date-time");
    }
    return ms;
  }

  const header = request.headers.get(IF_UNMODIFIED_SINCE_HEADER);
  if (header) {
    const ms = toEpochMs(header);
    if (ms === null) {
      throw ApiError.badRequest("If-Unmodified-Since must be a valid HTTP date");
    }
    return ms;
  }

  return null;
}

/**
 * Enforce the optimistic-concurrency check. No-op when `expected` is null
 * (client sent no token). Otherwise throws ApiError.conflict(409) when the
 * record's current `updatedAt` is newer than the version the client expected.
 *
 * Comparison is at second precision when the token came from an HTTP-date
 * header; to be safe across both token forms we compare on whole seconds so a
 * sub-second `updatedAt` difference from a second-precision header does not
 * cause a spurious conflict.
 */
/**
 * Resolve the expected-version token from the If-Unmodified-Since header only
 * (epoch ms), or null when the header is absent. Throws ApiError.badRequest
 * when the header is present but unparseable. Used when the body field was
 * already parsed by Zod and only the header fallback remains.
 */
export function resolveExpectedVersionFromHeader(
  request: NextRequest
): number | null {
  const header = request.headers.get(IF_UNMODIFIED_SINCE_HEADER);
  if (!header) return null;
  const ms = toEpochMs(header);
  if (ms === null) {
    throw ApiError.badRequest("If-Unmodified-Since must be a valid HTTP date");
  }
  return ms;
}

export function assertUnmodified(
  expected: number | null,
  currentUpdatedAt: Date
): void {
  if (expected === null) return;
  const currentSec = Math.floor(currentUpdatedAt.getTime() / 1000);
  const expectedSec = Math.floor(expected / 1000);
  if (currentSec !== expectedSec) {
    throw ApiError.conflict(
      "The record was modified since you last loaded it. Refresh and try again."
    );
  }
}
