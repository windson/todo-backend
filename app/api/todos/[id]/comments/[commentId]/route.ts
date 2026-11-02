import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { UpdateCommentSchema } from "@/lib/validation";
import { requireUser } from "@/lib/auth";
import { requireTodoWrite } from "@/lib/todo-access";
import { logActivity, ActivityAction } from "@/lib/activity";

type RouteContext = { params: Promise<{ id: string; commentId: string }> };

/**
 * Verify the user may write to the parent todo (owner or editor) AND is the
 * author of the comment. A user may only edit/delete their own comment; the
 * parent-todo write check keeps viewers out. Throws ApiError.notFound to avoid
 * leaking the existence of a comment the user may not touch.
 */
async function requireOwnedComment(
  todoId: string,
  commentId: string,
  userId: string
) {
  // Owner or editor of the todo; viewer -> 403, unrelated -> 404.
  await requireTodoWrite(prisma, todoId, userId);

  const comment = await prisma.comment.findFirst({
    where: { id: commentId, todoId, userId },
  });
  if (!comment) {
    throw ApiError.notFound("Comment not found");
  }

  return comment;
}

/** Edit a comment (owner-scoped). */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { userId } = await requireUser(request);
    const { id, commentId } = await context.params;
    const body = await request.json();
    const parsed = UpdateCommentSchema.safeParse(body);

    if (!parsed.success) {
      throw ApiError.badRequest("Validation failed", parsed.error.issues);
    }

    await requireOwnedComment(id, commentId, userId);

    const comment = await prisma.comment.update({
      where: { id: commentId },
      data: { body: parsed.data.body },
    });

    await logActivity(prisma, {
      todoId: id,
      userId,
      action: ActivityAction.COMMENT_UPDATED,
      metadata: { commentId },
    });

    return successResponse(comment);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
  }
}

/** Delete a comment (owner-scoped). */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { userId } = await requireUser(request);
    const { id, commentId } = await context.params;

    await requireOwnedComment(id, commentId, userId);

    await prisma.comment.delete({ where: { id: commentId } });

    await logActivity(prisma, {
      todoId: id,
      userId,
      action: ActivityAction.COMMENT_DELETED,
      metadata: { commentId },
    });

    return successResponse({ message: "Comment deleted successfully" });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
  }
}
