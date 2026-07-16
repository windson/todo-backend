import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { UpdateTodoSchema } from "@/lib/validation";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;

    const todo = await prisma.todo.findUnique({
      where: { id },
      include: {
        category: true,
        tags: { include: { tag: true } },
      },
    });

    if (!todo) {
      throw ApiError.notFound("Todo not found");
    }

    const formattedTodo = {
      ...todo,
      tags: todo.tags.map((tt) => tt.tag),
    };

    return successResponse(formattedTodo);
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
    const { id } = await context.params;
    const body = await request.json();
    const parsed = UpdateTodoSchema.safeParse(body);

    if (!parsed.success) {
      throw ApiError.badRequest("Validation failed", parsed.error.issues);
    }

    const existing = await prisma.todo.findUnique({ where: { id } });
    if (!existing) {
      throw ApiError.notFound("Todo not found");
    }

    const { tagIds, ...updateData } = parsed.data;

    if (updateData.categoryId) {
      const category = await prisma.category.findUnique({
        where: { id: updateData.categoryId },
      });
      if (!category) {
        throw ApiError.badRequest("Category not found");
      }
    }

    const todo = await prisma.todo.update({
      where: { id },
      data: {
        ...updateData,
        tags: tagIds
          ? {
              deleteMany: {},
              create: tagIds.map((tagId) => ({ tagId })),
            }
          : undefined,
      },
      include: {
        category: true,
        tags: { include: { tag: true } },
      },
    });

    const formattedTodo = {
      ...todo,
      tags: todo.tags.map((tt) => tt.tag),
    };

    return successResponse(formattedTodo);
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
    const { id } = await context.params;

    const existing = await prisma.todo.findUnique({ where: { id } });
    if (!existing) {
      throw ApiError.notFound("Todo not found");
    }

    await prisma.todo.delete({ where: { id } });

    return successResponse({ message: "Todo deleted successfully" });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
  }
}
