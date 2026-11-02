import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { UpdateTagSchema } from "@/lib/validation";
import { requireUser } from "@/lib/auth";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { userId } = await requireUser(request);
    const { id } = await context.params;

    const tag = await prisma.tag.findFirst({
      where: { id, userId },
      include: {
        _count: { select: { todos: true } },
      },
    });

    if (!tag) {
      throw ApiError.notFound("Tag not found");
    }

    return successResponse({
      id: tag.id,
      name: tag.name,
      color: tag.color,
      usageCount: tag._count.todos,
    });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
  }
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { userId } = await requireUser(request);
    const { id } = await context.params;
    const body = await request.json();
    const parsed = UpdateTagSchema.safeParse(body);

    if (!parsed.success) {
      throw ApiError.badRequest("Validation failed", parsed.error.issues);
    }

    const existing = await prisma.tag.findFirst({ where: { id, userId } });
    if (!existing) {
      throw ApiError.notFound("Tag not found");
    }

    if (parsed.data.name && parsed.data.name !== existing.name) {
      const duplicate = await prisma.tag.findFirst({
        where: { userId, name: parsed.data.name },
      });
      if (duplicate) {
        throw ApiError.conflict("A tag with this name already exists");
      }
    }

    const tag = await prisma.tag.update({
      where: { id },
      data: parsed.data,
    });

    return successResponse(tag);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
  }
}

export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { userId } = await requireUser(request);
    const { id } = await context.params;

    const existing = await prisma.tag.findFirst({ where: { id, userId } });
    if (!existing) {
      throw ApiError.notFound("Tag not found");
    }

    await prisma.tag.delete({ where: { id } });

    return successResponse({ message: "Tag deleted successfully" });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
  }
}
