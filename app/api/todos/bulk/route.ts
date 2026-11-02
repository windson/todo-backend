import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { BulkOperationSchema } from "@/lib/validation";
import { requireUser } from "@/lib/auth";
import { generateNextOccurrence } from "@/lib/recurrence-service";

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
        // Load the recurring, not-yet-completed todos in this batch BEFORE the
        // updateMany so we can spawn their next occurrences (updateMany does not
        // return rows). Non-recurring todos just get flipped to completed.
        const recurringToComplete = await prisma.todo.findMany({
          where: {
            id: { in: ids },
            userId,
            completed: false,
            recurrenceRule: { not: null },
          },
          include: { tags: { select: { tagId: true } } },
        });

        const result = await prisma.todo.updateMany({
          where: { id: { in: ids }, userId },
          data: { completed: true },
        });

        // Generation is idempotent (guarded by recurrenceGeneratedId) so
        // re-running a bulk complete will not create duplicates.
        for (const source of recurringToComplete) {
          await generateNextOccurrence(prisma, source);
        }

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
