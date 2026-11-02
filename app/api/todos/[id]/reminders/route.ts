import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, createdResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { CreateReminderSchema } from "@/lib/validation";
import { requireUser } from "@/lib/auth";
import { logActivity, ActivityAction } from "@/lib/activity";

type RouteContext = { params: Promise<{ id: string }> };

/** List the reminders scheduled on a todo (owner-scoped, soonest first). */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { userId } = await requireUser(request);
    const { id } = await context.params;

    const todo = await prisma.todo.findFirst({ where: { id, userId } });
    if (!todo) {
      throw ApiError.notFound("Todo not found");
    }

    const reminders = await prisma.reminder.findMany({
      where: { todoId: id },
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

    const todo = await prisma.todo.findFirst({ where: { id, userId } });
    if (!todo) {
      throw ApiError.notFound("Todo not found");
    }

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
