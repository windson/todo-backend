import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { UpdateTodoSchema } from "@/lib/validation";
import { requireUser } from "@/lib/auth";
import { formatTodo, todoInclude } from "@/lib/todo-format";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { userId } = await requireUser(request);
    const { id } = await context.params;

    const todo = await prisma.todo.findFirst({
      where: { id, userId },
      include: todoInclude,
    });

    if (!todo) {
      throw ApiError.notFound("Todo not found");
    }

    return successResponse(formatTodo(todo));
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
    const parsed = UpdateTodoSchema.safeParse(body);

    if (!parsed.success) {
      throw ApiError.badRequest("Validation failed", parsed.error.issues);
    }

    const existing = await prisma.todo.findFirst({
      where: { id, userId },
      include: { children: { select: { id: true } } },
    });
    if (!existing) {
      throw ApiError.notFound("Todo not found");
    }

    const { tagIds, ...updateData } = parsed.data;

    if (updateData.categoryId) {
      const category = await prisma.category.findFirst({
        where: { id: updateData.categoryId, userId },
      });
      if (!category) {
        throw ApiError.badRequest("Category not found");
      }
    }

    if (updateData.parentId) {
      if (updateData.parentId === id) {
        throw ApiError.badRequest("A todo cannot be its own parent");
      }
      // A todo that already has subtasks cannot itself become a subtask, which
      // would create a second level of nesting.
      if (existing.children.length > 0) {
        throw ApiError.badRequest("Cannot move a todo that has subtasks under another todo");
      }
      const parent = await prisma.todo.findFirst({
        where: { id: updateData.parentId, userId },
      });
      if (!parent) {
        throw ApiError.badRequest("Parent todo not found");
      }
      if (parent.parentId) {
        throw ApiError.badRequest("Cannot nest a subtask under another subtask");
      }
    }

    if (tagIds && tagIds.length > 0) {
      const tags = await prisma.tag.findMany({
        where: { id: { in: tagIds }, userId },
      });
      if (tags.length !== tagIds.length) {
        throw ApiError.badRequest("One or more tags not found");
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
      include: todoInclude,
    });

    return successResponse(formatTodo(todo));
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

    const existing = await prisma.todo.findFirst({ where: { id, userId } });
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
