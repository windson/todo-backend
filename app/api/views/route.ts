import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, createdResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { CreateSavedViewSchema } from "@/lib/validation";
import { requireUser } from "@/lib/auth";
import { Prisma } from "@prisma/client";

export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireUser(request);
    const views = await prisma.savedView.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
    return successResponse(views);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal(undefined, error));
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireUser(request);
    const body = await request.json();
    const parsed = CreateSavedViewSchema.safeParse(body);

    if (!parsed.success) {
      throw ApiError.badRequest("Validation failed", parsed.error.issues);
    }

    const existing = await prisma.savedView.findFirst({
      where: { userId, name: parsed.data.name },
    });
    if (existing) {
      throw ApiError.conflict("A saved view with this name already exists");
    }

    const view = await prisma.savedView.create({
      data: {
        userId,
        name: parsed.data.name,
        filters: parsed.data.filters as Prisma.InputJsonValue,
      },
    });

    return createdResponse(view);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal(undefined, error));
  }
}
