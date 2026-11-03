import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { UpdateCategorySchema } from "@/lib/validation";
import { requireUser } from "@/lib/auth";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { userId } = await requireUser(request);
    const { id } = await context.params;

    const category = await prisma.category.findFirst({
      where: { id, userId },
      include: {
        _count: { select: { todos: true } },
        todos: {
          take: 10,
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!category) {
      throw ApiError.notFound("Category not found");
    }

    const formattedCategory = {
      id: category.id,
      name: category.name,
      color: category.color,
      createdAt: category.createdAt,
      todoCount: category._count.todos,
      todos: category.todos,
    };

    return successResponse(formattedCategory);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal(undefined, error));
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
    const parsed = UpdateCategorySchema.safeParse(body);

    if (!parsed.success) {
      throw ApiError.badRequest("Validation failed", parsed.error.issues);
    }

    const existing = await prisma.category.findFirst({ where: { id, userId } });
    if (!existing) {
      throw ApiError.notFound("Category not found");
    }

    if (parsed.data.name && parsed.data.name !== existing.name) {
      const duplicate = await prisma.category.findFirst({
        where: { userId, name: parsed.data.name },
      });
      if (duplicate) {
        throw ApiError.conflict("A category with this name already exists");
      }
    }

    const category = await prisma.category.update({
      where: { id },
      data: parsed.data,
    });

    return successResponse(category);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal(undefined, error));
  }
}

export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { userId } = await requireUser(request);
    const { id } = await context.params;

    const existing = await prisma.category.findFirst({
      where: { id, userId },
      include: { _count: { select: { todos: true } } },
    });

    if (!existing) {
      throw ApiError.notFound("Category not found");
    }

    if (existing._count.todos > 0) {
      throw ApiError.conflict(
        `Cannot delete category with ${existing._count.todos} associated todo(s). Remove or reassign them first.`
      );
    }

    await prisma.category.delete({ where: { id } });

    return successResponse({ message: "Category deleted successfully" });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal(undefined, error));
  }
}
