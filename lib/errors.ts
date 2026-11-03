export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError(400, message, details);
  }

  static unauthorized(message = "Authentication required"): ApiError {
    return new ApiError(401, message);
  }

  static forbidden(message = "You do not have access to this resource"): ApiError {
    return new ApiError(403, message);
  }

  static notFound(message: string): ApiError {
    return new ApiError(404, message);
  }

  static conflict(message: string): ApiError {
    return new ApiError(409, message);
  }

  static internal(message = "Internal server error", cause?: unknown): ApiError {
    const err = new ApiError(500, message);
    if (cause !== undefined) {
      // Preserve the underlying cause for server-side logging. It is never
      // serialized into the HTTP response, so no internal detail leaks.
      (err as { cause?: unknown }).cause = cause;
    }
    return err;
  }
}
