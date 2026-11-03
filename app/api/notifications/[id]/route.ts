import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { MarkNotificationSchema } from "@/lib/validation";
import { requireUser } from "@/lib/auth";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Mark a notification read (or unread). Owner-scoped. Body `{ read }` defaults
 * to `true` so a bare PATCH marks the notification read.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { userId } = await requireUser(request);
    const { id } = await context.params;

    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const parsed = MarkNotificationSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest("Validation failed", parsed.error.issues);
    }

    const existing = await prisma.notification.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      throw ApiError.notFound("Notification not found");
    }

    const notification = await prisma.notification.update({
      where: { id },
      data: { read: parsed.data.read ?? true },
    });

    return successResponse(notification);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal(undefined, error));
  }
}
