import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { SharableUserQuerySchema } from "@/lib/validation";
import { requireUser } from "@/lib/auth";

/**
 * Look up a user to share a todo with, by EXACT email only. This deliberately
 * does NOT support partial/prefix search so it can never be used to enumerate
 * the user directory: it returns at most one user's minimal public info (id,
 * email, name) and null when no account matches. The current user never
 * resolves themselves (you cannot share a todo with yourself).
 */
export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const params = Object.fromEntries(searchParams.entries());

    const parsed = SharableUserQuerySchema.safeParse(params);
    if (!parsed.success) {
      throw ApiError.badRequest("Invalid query parameters", parsed.error.issues);
    }

    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email },
      select: { id: true, email: true, name: true },
    });

    // Never return the requesting user themselves.
    const result = user && user.id !== userId ? user : null;

    return successResponse(result);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
  }
}
