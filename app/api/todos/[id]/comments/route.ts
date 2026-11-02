import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, createdResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { CreateCommentSchema } from "@/lib/validation";
import { requireUser } from "@/lib/auth";
import { requireTodoRead, requireTodoWrite } from "@/lib/todo-access";
import { logActivity, ActivityAction } from "@/lib/activity";

type RouteContext = { params: Promise<{ id: string }> };

/** List the comment thread for a todo (owner or shared user). */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { userId } = await requireUser(request);
    const { id } = await context.params;

    // Any user who can read the todo (owner, editor, viewer) can read comments.
    await requireTodoRead(prisma, id, userId);

    const comments = await prisma.comment.findMany({
      where: { todoId: id },
      orderBy: { createdAt: "asc" },
    });

    return successResponse(comments);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
  }
}

/** Add a comment to a todo's thread. */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { userId } = await requireUser(request);
    const { id } = await context.params;
    const body = await request.json();
    const parsed = CreateCommentSchema.safeParse(body);

    if (!parsed.success) {
      throw ApiError.badRequest("Validation failed", parsed.error.issues);
    }

    // Commenting is a write: owner or editor only (viewers are read-only).
    await requireTodoWrite(prisma, id, userId);

    const comment = await prisma.comment.create({
      data: { body: parsed.data.body, todoId: id, userId },
    });

    await logActivity(prisma, {
      todoId: id,
      userId,
      action: ActivityAction.COMMENT_CREATED,
      metadata: { commentId: comment.id },
    });

    return createdResponse(comment);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
  }
}
