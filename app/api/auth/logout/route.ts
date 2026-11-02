import { cookies } from "next/headers";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { AUTH_COOKIE_NAME, sessionCookieOptions } from "@/lib/auth";

export async function POST() {
  try {
    const cookieStore = await cookies();
    // Expire the session cookie immediately.
    cookieStore.set(AUTH_COOKIE_NAME, "", sessionCookieOptions(0));

    return successResponse({ message: "Logged out successfully" });
  } catch {
    return errorResponse(ApiError.internal());
  }
}
