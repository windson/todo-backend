import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { requireUser } from "@/lib/auth";

type RouteContext = { params: Promise<{ id: string }> };

/** Read the append-only activity log for a todo (owner-scoped, newest first). */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { userId } = await requireUser(request);
    const { id } = await context.params;

    const todo = await prisma.todo.findFirst({ where: { id, userId } });
    if (!todo) {
      throw ApiError.notFound("Todo not found");
    }

    const activity = await prisma.activityLog.findMany({
      where: { todoId: id },
      orderBy: { createdAt: "desc" },
    });

    return successResponse(activity);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
  }
}
