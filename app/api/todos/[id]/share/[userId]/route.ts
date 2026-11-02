import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { UpdateShareSchema } from "@/lib/validation";
import { requireUser } from "@/lib/auth";
import { requireTodoManage } from "@/lib/todo-access";
import { logActivity, ActivityAction } from "@/lib/activity";

type RouteContext = { params: Promise<{ id: string; userId: string }> };

const shareUserSelect = { id: true, email: true, name: true } as const;

/** Change a collaborator's role on a shared todo. Owner only. */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { userId: actorId } = await requireUser(request);
    const { id, userId: memberId } = await context.params;
    const body = await request.json();
    const parsed = UpdateShareSchema.safeParse(body);

    if (!parsed.success) {
      throw ApiError.badRequest("Validation failed", parsed.error.issues);
    }

    await requireTodoManage(prisma, id, actorId);

    const existing = await prisma.todoShare.findUnique({
      where: { todoId_userId: { todoId: id, userId: memberId } },
    });
    if (!existing) {
      throw ApiError.notFound("Share not found");
    }

    const share = await prisma.todoShare.update({
      where: { todoId_userId: { todoId: id, userId: memberId } },
      data: { role: parsed.data.role },
      include: { user: { select: shareUserSelect } },
    });

    await logActivity(prisma, {
      todoId: id,
      userId: actorId,
      action: ActivityAction.TODO_SHARE_UPDATED,
      metadata: { sharedWithUserId: memberId, role: parsed.data.role },
    });

    return successResponse(share);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
  }
}

/** Revoke a collaborator's access to a todo (unshare). Owner only. */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { userId: actorId } = await requireUser(request);
    const { id, userId: memberId } = await context.params;

    await requireTodoManage(prisma, id, actorId);

    const existing = await prisma.todoShare.findUnique({
      where: { todoId_userId: { todoId: id, userId: memberId } },
    });
    if (!existing) {
      throw ApiError.notFound("Share not found");
    }

    await prisma.todoShare.delete({
      where: { todoId_userId: { todoId: id, userId: memberId } },
    });

    // If the removed user was the assignee, clear the assignment so a revoked
    // user is never left assigned.
    await prisma.todo.updateMany({
      where: { id, assigneeId: memberId },
      data: { assigneeId: null },
    });

    await logActivity(prisma, {
      todoId: id,
      userId: actorId,
      action: ActivityAction.TODO_UNSHARED,
      metadata: { sharedWithUserId: memberId },
    });

    return successResponse({ message: "Share removed successfully" });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
  }
}
