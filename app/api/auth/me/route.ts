import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { requireUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireUser(request);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, createdAt: true },
    });

    if (!user) {
      throw ApiError.unauthorized();
    }

    return successResponse(user);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal(undefined, error));
  }
}
