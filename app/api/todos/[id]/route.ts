import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { UpdateTodoSchema } from "@/lib/validation";
import { requireUser } from "@/lib/auth";
import { formatTodo, todoInclude } from "@/lib/todo-format";
import { generateNextOccurrence } from "@/lib/recurrence-service";
import { logActivity, ActivityAction } from "@/lib/activity";
import { requireTodoRead, requireTodoWrite, requireTodoManage, isAssigneeAllowed } from "@/lib/todo-access";
import { notifyAssigned } from "@/lib/collaboration-notify";
import { assertUnmodified, resolveExpectedVersionFromHeader } from "@/lib/concurrency";
import { logRequest } from "@/lib/request-log";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { userId } = await requireUser(request);
    const { id } = await context.params;

    // Owner OR a user the todo is shared with may read it.
    await requireTodoRead(prisma, id, userId);

    const todo = await prisma.todo.findUnique({
      where: { id },
      include: todoInclude,
    });

    if (!todo) {
      throw ApiError.notFound("Todo not found");
    }

    return successResponse(formatTodo(todo));
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
  }
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  const startedAt = Date.now();
  let currentUserId: string | null = null;
  try {
    const { userId } = await requireUser(request);
    currentUserId = userId;
    const { id } = await context.params;
    const body = await request.json();
    const parsed = UpdateTodoSchema.safeParse(body);

    if (!parsed.success) {
      throw ApiError.badRequest("Validation failed", parsed.error.issues);
    }

    // Owner OR an editor may modify the todo; a viewer gets 403, an unrelated
    // user gets 404.
    const access = await requireTodoWrite(prisma, id, userId);

    const existing = await prisma.todo.findUnique({
      where: { id },
      include: {
        children: { select: { id: true } },
        tags: { select: { tagId: true } },
      },
    });
    if (!existing) {
      throw ApiError.notFound("Todo not found");
    }

    const { tagIds, expectedUpdatedAt, ...updateData } = parsed.data;

    // Optimistic concurrency: when the client sends expectedUpdatedAt (via the
    // validated body field) OR an If-Unmodified-Since header, reject with 409
    // if the todo changed since. Backward compatible: with no token the update
    // proceeds unconditionally as before.
    const expectedVersion =
      expectedUpdatedAt !== undefined
        ? expectedUpdatedAt.getTime()
        : resolveExpectedVersionFromHeader(request);
    assertUnmodified(expectedVersion, existing.updatedAt);

    // Category, parent, and tags belong to the todo's OWNER's space, so they
    // are validated against ownerId (an editor edits within the owner's data).
    const ownerId = access.ownerId;

    if (updateData.categoryId) {
      const category = await prisma.category.findFirst({
        where: { id: updateData.categoryId, userId: ownerId },
      });
      if (!category) {
        throw ApiError.badRequest("Category not found");
      }
    }

    if (updateData.parentId) {
      if (updateData.parentId === id) {
        throw ApiError.badRequest("A todo cannot be its own parent");
      }
      // A todo that already has subtasks cannot itself become a subtask, which
      // would create a second level of nesting.
      if (existing.children.length > 0) {
        throw ApiError.badRequest("Cannot move a todo that has subtasks under another todo");
      }
      const parent = await prisma.todo.findFirst({
        where: { id: updateData.parentId, userId: ownerId },
      });
      if (!parent) {
        throw ApiError.badRequest("Parent todo not found");
      }
      if (parent.parentId) {
        throw ApiError.badRequest("Cannot nest a subtask under another subtask");
      }
    }

    if (tagIds && tagIds.length > 0) {
      const tags = await prisma.tag.findMany({
        where: { id: { in: tagIds }, userId: ownerId },
      });
      if (tags.length !== tagIds.length) {
        throw ApiError.badRequest("One or more tags not found");
      }
    }

    // Assignee must be the owner or a user the todo is shared with. null clears
    // the assignment.
    if (updateData.assigneeId) {
      const allowed = await isAssigneeAllowed(prisma, id, ownerId, updateData.assigneeId);
      if (!allowed) {
        throw ApiError.badRequest(
          "Assignee must be the owner or a user the todo is shared with"
        );
      }
    }

    const todo = await prisma.todo.update({
      where: { id },
      data: {
        ...updateData,
        tags: tagIds
          ? {
              deleteMany: {},
              create: tagIds.map((tagId) => ({ tagId })),
            }
          : undefined,
      },
      include: todoInclude,
    });

    // When a recurring todo transitions to completed, spawn the next
    // occurrence. Generation is idempotent (guarded by recurrenceGeneratedId).
    const becameCompleted = existing.completed === false && updateData.completed === true;
    if (becameCompleted && existing.recurrenceRule) {
      await generateNextOccurrence(prisma, {
        id: existing.id,
        title: todo.title,
        description: todo.description,
        priority: todo.priority,
        startDate: todo.startDate,
        dueDate: todo.dueDate,
        recurrenceRule: todo.recurrenceRule,
        recurrenceInterval: todo.recurrenceInterval,
        recurrenceGeneratedId: existing.recurrenceGeneratedId,
        // The spawned occurrence belongs to the todo's owner, not the acting
        // editor.
        userId: ownerId,
        categoryId: todo.categoryId,
        parentId: todo.parentId,
        tags: existing.tags,
      });
    }

    // Record the change in the activity log. A completion/uncompletion is
    // logged with a dedicated action; all other field changes are a generic
    // update that notes which fields were touched.
    const becameUncompleted = existing.completed === true && updateData.completed === false;
    if (becameCompleted) {
      await logActivity(prisma, {
        todoId: id,
        userId,
        action: ActivityAction.TODO_COMPLETED,
      });
    } else if (becameUncompleted) {
      await logActivity(prisma, {
        todoId: id,
        userId,
        action: ActivityAction.TODO_UNCOMPLETED,
      });
    } else {
      await logActivity(prisma, {
        todoId: id,
        userId,
        action: ActivityAction.TODO_UPDATED,
        metadata: { fields: Object.keys(parsed.data) },
      });
    }

    // Record assignment changes explicitly so they appear in the activity trail
    // and can trigger a notification for the new assignee.
    if (updateData.assigneeId !== undefined && updateData.assigneeId !== existing.assigneeId) {
      if (updateData.assigneeId) {
        await logActivity(prisma, {
          todoId: id,
          userId,
          action: ActivityAction.TODO_ASSIGNED,
          metadata: { assigneeId: updateData.assigneeId },
        });
        // Notify the new assignee (unless they assigned the todo to themselves).
        if (updateData.assigneeId !== userId) {
          await notifyAssigned(updateData.assigneeId, id, todo.title);
        }
      } else {
        await logActivity(prisma, {
          todoId: id,
          userId,
          action: ActivityAction.TODO_UNASSIGNED,
        });
      }
    }

    const response = successResponse(formatTodo(todo));
    logRequest({
      method: "PATCH",
      path: "/api/todos/[id]",
      status: 200,
      durationMs: Math.round(Date.now() - startedAt),
      userId: currentUserId,
    });
    return response;
  } catch (error) {
    const response =
      error instanceof ApiError ? errorResponse(error) : errorResponse(ApiError.internal());
    logRequest({
      method: "PATCH",
      path: "/api/todos/[id]",
      status: response.status,
      durationMs: Math.round(Date.now() - startedAt),
      userId: currentUserId,
    });
    return response;
  }
}

export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { userId } = await requireUser(request);
    const { id } = await context.params;

    // Only the owner may delete a todo (shared editors/viewers cannot).
    await requireTodoManage(prisma, id, userId);

    const existing = await prisma.todo.findUnique({ where: { id } });
    if (!existing) {
      throw ApiError.notFound("Todo not found");
    }

    // Record the deletion before removing the todo. The log row is on the todo
    // itself, so the DB cascade removes it along with the todo; the write is
    // kept for consistency with the activity-trail convention (and so a future
    // feature that logs to a user-level trail can reuse the same call site).
    await logActivity(prisma, {
      todoId: id,
      userId,
      action: ActivityAction.TODO_DELETED,
      metadata: { title: existing.title },
    });

    await prisma.todo.delete({ where: { id } });

    return successResponse({ message: "Todo deleted successfully" });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
  }
}
