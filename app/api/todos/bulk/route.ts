import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { BulkOperationSchema } from "@/lib/validation";
import { requireUser } from "@/lib/auth";
import { generateNextOccurrence } from "@/lib/recurrence-service";
import { notifyAssigned } from "@/lib/collaboration-notify";

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
      case "setPriority": {
        const result = await prisma.todo.updateMany({
          where: { id: { in: ids }, userId },
          data: { priority: parsed.data.priority },
        });
        return successResponse({
          message: `${result.count} todo(s) updated to ${parsed.data.priority} priority`,
          count: result.count,
        });
      }

      case "setCategory": {
        const { categoryId } = parsed.data;
        // A non-null categoryId MUST belong to the current user; clearing with
        // null is always allowed.
        if (categoryId !== null) {
          const category = await prisma.category.findFirst({
            where: { id: categoryId, userId },
          });
          if (!category) {
            throw ApiError.badRequest("Category not found");
          }
        }
        const result = await prisma.todo.updateMany({
          where: { id: { in: ids }, userId },
          data: { categoryId },
        });
        return successResponse({
          message: categoryId
            ? `${result.count} todo(s) moved to the selected category`
            : `${result.count} todo(s) had their category cleared`,
          count: result.count,
        });
      }

      case "addTags": {
        const { tagIds } = parsed.data;
        // Every referenced tag MUST belong to the current user.
        const tags = await prisma.tag.findMany({
          where: { id: { in: tagIds }, userId },
        });
        if (tags.length !== new Set(tagIds).size) {
          throw ApiError.badRequest("One or more tags not found");
        }
        // Only touch todos the user owns, then upsert the join rows. createMany
        // with skipDuplicates keeps the operation idempotent.
        const ownedTodos = await prisma.todo.findMany({
          where: { id: { in: ids }, userId },
          select: { id: true },
        });
        const joinRows = ownedTodos.flatMap((todo) =>
          tagIds.map((tagId) => ({ todoId: todo.id, tagId }))
        );
        if (joinRows.length > 0) {
          await prisma.todoTag.createMany({
            data: joinRows,
            skipDuplicates: true,
          });
        }
        return successResponse({
          message: `Tags added to ${ownedTodos.length} todo(s)`,
          count: ownedTodos.length,
        });
      }

      case "removeTags": {
        const { tagIds } = parsed.data;
        const ownedTodos = await prisma.todo.findMany({
          where: { id: { in: ids }, userId },
          select: { id: true },
        });
        const ownedIds = ownedTodos.map((todo) => todo.id);
        const result = await prisma.todoTag.deleteMany({
          where: { todoId: { in: ownedIds }, tagId: { in: tagIds } },
        });
        return successResponse({
          message: `Removed ${result.count} tag association(s) from ${ownedTodos.length} todo(s)`,
          count: ownedTodos.length,
        });
      }

      case "setAssignee": {
        const { assigneeId } = parsed.data;
        // Bulk assign only touches todos the user OWNS. A null assigneeId
        // clears the assignment; a non-null one must be the owner themselves OR
        // a user who is shared on every affected owned todo.
        const ownedTodos = await prisma.todo.findMany({
          where: { id: { in: ids }, userId },
          select: { id: true, title: true },
        });
        const ownedIds = ownedTodos.map((todo) => todo.id);

        if (assigneeId !== null && assigneeId !== userId) {
          // The candidate must be shared on all affected todos.
          const shares = await prisma.todoShare.findMany({
            where: { todoId: { in: ownedIds }, userId: assigneeId },
            select: { todoId: true },
          });
          if (shares.length !== ownedIds.length) {
            throw ApiError.badRequest(
              "Assignee must be the owner or a user every selected todo is shared with"
            );
          }
        }

        const result = await prisma.todo.updateMany({
          where: { id: { in: ownedIds }, userId },
          data: { assigneeId },
        });

        // Notify the assignee (unless they assigned to themselves).
        if (assigneeId && assigneeId !== userId) {
          for (const todo of ownedTodos) {
            await notifyAssigned(assigneeId, todo.id, todo.title);
          }
        }

        return successResponse({
          message: assigneeId
            ? `${result.count} todo(s) assigned`
            : `${result.count} todo(s) unassigned`,
          count: result.count,
        });
      }

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
