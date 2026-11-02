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

/**
 * Precision at which an expected-version token is compared against the
 * record's current `updatedAt`:
 *  - "ms": full millisecond precision. Use for the `expectedUpdatedAt` body
 *    field, which carries a full ISO timestamp — two writes in the same wall
 *    clock second MUST still conflict.
 *  - "second": whole-second precision. Use for the `If-Unmodified-Since` HTTP
 *    header, which is an HTTP-date and only carries second precision, so a
 *    sub-second `updatedAt` difference must not cause a spurious conflict.
 */
export type VersionPrecision = "ms" | "second";

/**
 * Enforce the optimistic-concurrency check. No-op when `expected` is null
 * (client sent no token). Otherwise throws ApiError.conflict(409) when the
 * record's current `updatedAt` differs from the version the client expected.
 *
 * The body-field token (`expectedUpdatedAt`) carries millisecond precision and
 * is compared at full precision ("ms"), so two writes landing in the same
 * wall-clock second still conflict. The `If-Unmodified-Since` header path only
 * has second precision and must be compared at "second" granularity to avoid a
 * spurious conflict. Defaults to "ms" so the stricter check is the default.
 */
export function assertUnmodified(
  expected: number | null,
  currentUpdatedAt: Date,
  precision: VersionPrecision = "ms"
): void {
  if (expected === null) return;

  const current = currentUpdatedAt.getTime();

  if (precision === "second") {
    const currentSec = Math.floor(current / 1000);
    const expectedSec = Math.floor(expected / 1000);
    if (currentSec !== expectedSec) {
      throw ApiError.conflict(
        "The record was modified since you last loaded it. Refresh and try again."
      );
    }
    return;
  }

  if (current !== expected) {
    throw ApiError.conflict(
      "The record was modified since you last loaded it. Refresh and try again."
    );
  }
}
