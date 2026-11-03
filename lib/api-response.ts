import { NextResponse } from "next/server";
import { ApiError } from "./errors";

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

/**
 * Log an unexpected server-side error (message + stack) to stderr so the real
 * cause is captured by the platform log stream (e.g. CloudWatch). This is the
 * only place that should surface internal error detail; HTTP responses stay
 * generic so nothing sensitive leaks to clients.
 */
export function logServerError(error: unknown): void {
  if (error instanceof Error) {
    console.error("[api] Unhandled server error:", error.stack ?? error.message);
  } else {
    console.error("[api] Unhandled non-error thrown:", error);
  }
}

export function successResponse<T>(
  data: T,
  status = 200,
  headers?: Record<string, string>
): NextResponse<ApiSuccessResponse<T>> {
  return NextResponse.json(
    { success: true, data },
    { status, headers }
  );
}

export function errorResponse(
  error: ApiError | Error | unknown,
  defaultStatus = 500
): NextResponse<ApiErrorResponse> {
  if (error instanceof ApiError) {
    // Server (5xx) ApiErrors represent unexpected failures surfaced with a
    // generic client message; log their underlying cause (if any) so the real
    // reason is visible in CloudWatch, while the response stays generic.
    if (error.statusCode >= 500) {
      const cause = (error as { cause?: unknown }).cause;
      logServerError(cause !== undefined ? cause : error);
    }
    return NextResponse.json(
      {
        success: false,
        error: {
          message: error.message,
          details: error.details,
        },
      },
      { status: error.statusCode }
    );
  }

  // Anything that is not an ApiError is an unexpected server-side failure
  // (e.g. a database connection error). Log the underlying detail so the real
  // cause is visible in logs/CloudWatch, while keeping the HTTP response
  // generic so no internal detail leaks to clients.
  logServerError(error);

  return NextResponse.json(
    {
      success: false,
      error: { message: "An unexpected error occurred" },
    },
    { status: defaultStatus }
  );
}

export function createdResponse<T>(
  data: T,
  headers?: Record<string, string>
): NextResponse<ApiSuccessResponse<T>> {
  return successResponse(data, 201, headers);
}
