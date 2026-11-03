import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { TodoTagsSchema, RemoveTagSchema } from "@/lib/validation";
import { requireUser } from "@/lib/auth";
import { requireTodoWrite } from "@/lib/todo-access";

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

    const access = await requireTodoWrite(prisma, id, userId);

    const { tagIds } = parsed.data;

    // Verify all tags exist and belong to the todo's owner.
    const tags = await prisma.tag.findMany({
      where: { id: { in: tagIds }, userId: access.ownerId },
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
    const body = await request.json();
    const parsed = RemoveTagSchema.safeParse(body);

    if (!parsed.success) {
      throw ApiError.badRequest("Validation failed", parsed.error.issues);
    }

    await requireTodoWrite(prisma, id, userId);

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
    return errorResponse(ApiError.internal(undefined, error));
  }
}
