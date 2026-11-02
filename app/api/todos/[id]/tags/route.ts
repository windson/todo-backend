import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { TodoTagsSchema, RemoveTagSchema } from "@/lib/validation";
import { requireUser } from "@/lib/auth";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { userId } = await requireUser(request);
    const { id } = await context.params;
    const body = await request.json();
    const parsed = TodoTagsSchema.safeParse(body);

    if (!parsed.success) {
      throw ApiError.badRequest("Validation failed", parsed.error.issues);
    }

    const todo = await prisma.todo.findFirst({ where: { id, userId } });
    if (!todo) {
      throw ApiError.notFound("Todo not found");
    }

    const { tagIds } = parsed.data;

    // Verify all tags exist and belong to the user
    const tags = await prisma.tag.findMany({
      where: { id: { in: tagIds }, userId },
    });
    if (tags.length !== tagIds.length) {
      throw ApiError.badRequest("One or more tags not found");
    }

    // Create connections, skipping duplicates
    await prisma.todoTag.createMany({
      data: tagIds.map((tagId) => ({ todoId: id, tagId })),
      skipDuplicates: true,
    });

    const updatedTodo = await prisma.todo.findUnique({
      where: { id },
      include: {
        category: true,
        tags: { include: { tag: true } },
      },
    });

    const formattedTodo = {
      ...updatedTodo!,
      tags: updatedTodo!.tags.map((tt) => tt.tag),
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
    const { userId } = await requireUser(request);
    const { id } = await context.params;
    const body = await request.json();
    const parsed = RemoveTagSchema.safeParse(body);

    if (!parsed.success) {
      throw ApiError.badRequest("Validation failed", parsed.error.issues);
    }

    const todo = await prisma.todo.findFirst({ where: { id, userId } });
    if (!todo) {
      throw ApiError.notFound("Todo not found");
    }

    const { tagId } = parsed.data;

    await prisma.todoTag.delete({
      where: {
        todoId_tagId: { todoId: id, tagId },
      },
    });

    const updatedTodo = await prisma.todo.findUnique({
      where: { id },
      include: {
        category: true,
        tags: { include: { tag: true } },
      },
    });

    const formattedTodo = {
      ...updatedTodo!,
      tags: updatedTodo!.tags.map((tt) => tt.tag),
    };

    return successResponse(formattedTodo);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
  }
}
