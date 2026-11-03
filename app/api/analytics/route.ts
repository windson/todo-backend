import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { AnalyticsQueryParamsSchema } from "@/lib/validation";
import { requireUser } from "@/lib/auth";
import { computeAnalytics, DEFAULT_TREND_DAYS } from "@/lib/analytics";

/**
 * GET /api/analytics
 * Per-user productivity analytics over the user's OWNED todos (shared todos are
 * excluded to avoid double-counting across users). Returns totals, overdue
 * count, breakdowns by priority/status/category, and a completion trend over
 * the last `days` days (default 30).
 */
export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const params = Object.fromEntries(searchParams.entries());

    const parsed = AnalyticsQueryParamsSchema.safeParse(params);
    if (!parsed.success) {
      throw ApiError.badRequest("Invalid query parameters", parsed.error.issues);
    }

    const days = parsed.data.days ?? DEFAULT_TREND_DAYS;
    const analytics = await computeAnalytics(prisma, userId, days);

    return successResponse(analytics);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal(undefined, error));
  }
}
