import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { NotificationQueryParamsSchema } from "@/lib/validation";
import { requireUser } from "@/lib/auth";

/**
 * List the authenticated user's notifications (newest first). Pass `read=false`
 * to fetch only unread notifications (used by the frontend bell). Responds with
 * an X-Total-Count header for the total matching notifications.
 */
export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireUser(request);

    const { searchParams } = new URL(request.url);
    const parsed = NotificationQueryParamsSchema.safeParse(
      Object.fromEntries(searchParams)
    );
    if (!parsed.success) {
      throw ApiError.badRequest("Validation failed", parsed.error.issues);
    }

    const where = {
      userId,
      ...(parsed.data.read !== undefined
        ? { read: parsed.data.read === "true" }
        : {}),
    };

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: parsed.data.limit,
        skip: parsed.data.offset,
      }),
      prisma.notification.count({ where }),
    ]);

    return successResponse(notifications, 200, {
      "X-Total-Count": String(total),
    });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
  }
}
