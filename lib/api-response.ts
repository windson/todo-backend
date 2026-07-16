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

  if (error instanceof Error) {
    return NextResponse.json(
      {
        success: false,
        error: { message: error.message },
      },
      { status: defaultStatus }
    );
  }

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
