import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { UpdateReminderSchema } from "@/lib/validation";
import { requireUser } from "@/lib/auth";
import { logActivity, ActivityAction } from "@/lib/activity";

type RouteContext = { params: Promise<{ id: string; reminderId: string }> };

/**
 * Load the reminder and verify both its parent todo and the reminder itself
 * belong to the authenticated user, throwing ApiError.notFound otherwise.
 */
async function requireOwnedReminder(
  todoId: string,
  reminderId: string,
  userId: string
) {
  const todo = await prisma.todo.findFirst({ where: { id: todoId, userId } });
  if (!todo) {
    throw ApiError.notFound("Todo not found");
  }

  const reminder = await prisma.reminder.findFirst({
    where: { id: reminderId, todoId, userId },
  });
  if (!reminder) {
    throw ApiError.notFound("Reminder not found");
  }

  return reminder;
}

/** Update a scheduled reminder (owner-scoped). */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { userId } = await requireUser(request);
    const { id, reminderId } = await context.params;
    const body = await request.json();
    const parsed = UpdateReminderSchema.safeParse(body);

    if (!parsed.success) {
      throw ApiError.badRequest("Validation failed", parsed.error.issues);
    }

    await requireOwnedReminder(id, reminderId, userId);

    const reminder = await prisma.reminder.update({
      where: { id: reminderId },
      data: {
        ...(parsed.data.remindAt !== undefined ? { remindAt: parsed.data.remindAt } : {}),
        ...(parsed.data.channel !== undefined ? { channel: parsed.data.channel } : {}),
      },
    });

    return successResponse(reminder);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
  }
}

/** Delete a scheduled reminder (owner-scoped). */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { userId } = await requireUser(request);
    const { id, reminderId } = await context.params;

    await requireOwnedReminder(id, reminderId, userId);

    await prisma.reminder.delete({ where: { id: reminderId } });

    await logActivity(prisma, {
      todoId: id,
      userId,
      action: ActivityAction.REMINDER_DELETED,
      metadata: { reminderId },
    });

    return successResponse({ message: "Reminder deleted successfully" });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
  }
}
