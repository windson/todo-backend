/**
 * Structured request logging.
 *
 * Emits one parseable JSON line per request to the console with the method,
 * path, status, duration, and (when known) the authenticated user id. The log
 * NEVER includes the request/response body, headers, cookies, tokens, or any
 * credential - only coarse routing metadata - so it is safe to ship to a log
 * aggregator.
 *
 * Logging is enabled by default; set REQUEST_LOG_ENABLED=false to silence it
 * (e.g. to keep test output quiet). Tests set this to false.
 */

export interface RequestLogFields {
  method: string;
  path: string;
  status: number;
  /** Request duration in milliseconds (rounded). */
  durationMs: number;
  /** Authenticated user id, or null for unauthenticated requests. */
  userId: string | null;
}

export function isRequestLogEnabled(): boolean {
  // Default on, opt-out via env. Vitest sets REQUEST_LOG_ENABLED=false.
  return process.env.REQUEST_LOG_ENABLED !== "false";
}

/**
 * Write a single structured log line. The shape is a stable JSON object so logs
 * can be parsed downstream (level, a fixed `msg`, an ISO timestamp, and the
 * request fields).
 */
export function logRequest(fields: RequestLogFields): void {
  if (!isRequestLogEnabled()) return;
  const line = {
    level: "info",
    msg: "api_request",
    time: new Date().toISOString(),
    method: fields.method,
    path: fields.path,
    status: fields.status,
    durationMs: fields.durationMs,
    userId: fields.userId,
  };
  console.log(JSON.stringify(line));
}
