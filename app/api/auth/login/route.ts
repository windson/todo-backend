import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { LoginSchema } from "@/lib/validation";
import {
  verifyPassword,
  createToken,
  AUTH_COOKIE_NAME,
  SESSION_MAX_AGE,
  sessionCookieOptions,
} from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = LoginSchema.safeParse(body);

    if (!parsed.success) {
      throw ApiError.badRequest("Validation failed", parsed.error.issues);
    }

    const { email, password } = parsed.data;
    const normalizedEmail = email.toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    // Use the same error for unknown email and bad password to avoid leaking
    // which accounts exist.
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw ApiError.unauthorized("Invalid email or password");
    }

    const token = await createToken({ userId: user.id, email: user.email });
    const cookieStore = await cookies();
    cookieStore.set(AUTH_COOKIE_NAME, token, sessionCookieOptions(SESSION_MAX_AGE));

    return successResponse({
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
    });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
  }
}
