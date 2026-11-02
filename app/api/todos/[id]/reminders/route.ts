import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, createdResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { CreateReminderSchema } from "@/lib/validation";
import { requireUser } from "@/lib/auth";
import { requireTodoRead, requireTodoWrite } from "@/lib/todo-access";
import { logActivity, ActivityAction } from "@/lib/activity";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * List the reminders the current user scheduled on a todo (soonest first).
 * Reminders are personal, so each user only sees their own even on a shared
 * todo.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { userId } = await requireUser(request);
    const { id } = await context.params;

    await requireTodoRead(prisma, id, userId);

    const reminders = await prisma.reminder.findMany({
      where: { todoId: id, userId },
      orderBy: { remindAt: "asc" },
    });

    return successResponse(reminders);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
  }
}

/** Schedule a reminder on a todo. */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { userId } = await requireUser(request);
    const { id } = await context.params;
    const body = await request.json();
    const parsed = CreateReminderSchema.safeParse(body);

    if (!parsed.success) {
      throw ApiError.badRequest("Validation failed", parsed.error.issues);
    }

    await requireTodoWrite(prisma, id, userId);

    const reminder = await prisma.reminder.create({
      data: {
        todoId: id,
        userId,
        remindAt: parsed.data.remindAt,
        channel: parsed.data.channel ?? "INAPP",
      },
    });

    await logActivity(prisma, {
      todoId: id,
      userId,
      action: ActivityAction.REMINDER_CREATED,
      metadata: { reminderId: reminder.id, channel: reminder.channel },
    });

    return createdResponse(reminder);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
  }
}
