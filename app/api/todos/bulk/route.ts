import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { BulkOperationSchema } from "@/lib/validation";
import { requireUser } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireUser(request);
    const body = await request.json();
    const parsed = BulkOperationSchema.safeParse(body);

    if (!parsed.success) {
      throw ApiError.badRequest("Validation failed", parsed.error.issues);
    }

    const { operation, ids } = parsed.data;

    switch (operation) {
      case "complete": {
        const result = await prisma.todo.updateMany({
          where: { id: { in: ids }, userId },
          data: { completed: true },
        });
        return successResponse({
          message: `${result.count} todo(s) marked as completed`,
          count: result.count,
        });
      }

      case "uncomplete": {
        const result = await prisma.todo.updateMany({
          where: { id: { in: ids }, userId },
          data: { completed: false },
        });
        return successResponse({
          message: `${result.count} todo(s) marked as uncompleted`,
          count: result.count,
        });
      }

      case "delete": {
        const result = await prisma.todo.deleteMany({
          where: { id: { in: ids }, userId },
        });
        return successResponse({
          message: `${result.count} todo(s) deleted`,
          count: result.count,
        });
      }

      default:
        throw ApiError.badRequest("Invalid operation");
    }
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
  }
}
