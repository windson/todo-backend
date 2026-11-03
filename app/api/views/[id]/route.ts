import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { UpdateSavedViewSchema } from "@/lib/validation";
import { requireUser } from "@/lib/auth";
import { Prisma } from "@prisma/client";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { userId } = await requireUser(request);
    const { id } = await context.params;

    const view = await prisma.savedView.findFirst({ where: { id, userId } });
    if (!view) {
      throw ApiError.notFound("Saved view not found");
    }

    return successResponse(view);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal(undefined, error));
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { userId } = await requireUser(request);
    const { id } = await context.params;
    const body = await request.json();
    const parsed = UpdateSavedViewSchema.safeParse(body);

    if (!parsed.success) {
      throw ApiError.badRequest("Validation failed", parsed.error.issues);
    }

    const existing = await prisma.savedView.findFirst({ where: { id, userId } });
    if (!existing) {
      throw ApiError.notFound("Saved view not found");
    }

    if (parsed.data.name && parsed.data.name !== existing.name) {
      const duplicate = await prisma.savedView.findFirst({
        where: { userId, name: parsed.data.name },
      });
      if (duplicate) {
        throw ApiError.conflict("A saved view with this name already exists");
      }
    }

    const data: Prisma.SavedViewUpdateInput = {};
    if (parsed.data.name !== undefined) {
      data.name = parsed.data.name;
    }
    if (parsed.data.filters !== undefined) {
      data.filters = parsed.data.filters as Prisma.InputJsonValue;
    }

    const view = await prisma.savedView.update({
      where: { id },
      data,
    });

    return successResponse(view);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal(undefined, error));
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { userId } = await requireUser(request);
    const { id } = await context.params;

    const existing = await prisma.savedView.findFirst({ where: { id, userId } });
    if (!existing) {
      throw ApiError.notFound("Saved view not found");
    }

    await prisma.savedView.delete({ where: { id } });

    return successResponse({ message: "Saved view deleted successfully" });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal(undefined, error));
  }
}
