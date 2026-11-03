import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { requireUser } from "@/lib/auth";
import { requireTodoRead } from "@/lib/todo-access";

type RouteContext = { params: Promise<{ id: string }> };

/** Read the append-only activity log for a todo (owner or shared, newest first). */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { userId } = await requireUser(request);
    const { id } = await context.params;

    await requireTodoRead(prisma, id, userId);

    const activity = await prisma.activityLog.findMany({
      where: { todoId: id },
      orderBy: { createdAt: "desc" },
    });

    return successResponse(activity);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal(undefined, error));
  }
}
