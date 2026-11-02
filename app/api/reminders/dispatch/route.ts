import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { getCurrentUser, hasValidDispatchSecret } from "@/lib/auth";
import { dispatchDueReminders } from "@/lib/notifications";

/**
 * Dispatch all due reminders: find reminders whose remindAt has passed and that
 * have not been sent, deliver each over its channel's transport (in-app writes
 * a Notification row; email/push no-op when unconfigured), then stamp sentAt.
 *
 * PRODUCTION SCHEDULING: there is no in-process scheduler. In production an
 * external scheduler/cron (e.g. a Vercel Cron Job, an EventBridge/cron trigger,
 * or `curl` on a timer) must POST this endpoint on an interval.
 *
 * PROTECTION: this endpoint is protected two ways. By default it sits behind
 * the normal user auth guard (a logged-in user may trigger a dispatch). For an
 * unattended scheduler, set REMINDER_DISPATCH_SECRET and send it in the
 * `X-Dispatch-Secret` header; the middleware lets that specific request through
 * and this handler re-validates it. The guard is never weakened for any other
 * route. If neither a valid user nor a valid secret is present, respond 401.
 */
export async function POST(request: NextRequest) {
  try {
    const secretOk = hasValidDispatchSecret(request);
    const user = secretOk ? null : await getCurrentUser(request);
    if (!secretOk && !user) {
      throw ApiError.unauthorized();
    }

    const result = await dispatchDueReminders(prisma);

    return successResponse(result);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
  }
}
