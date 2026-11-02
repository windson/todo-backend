import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { UpdateTodoSchema } from "@/lib/validation";
import { requireUser } from "@/lib/auth";
import { formatTodo, todoInclude } from "@/lib/todo-format";
import { generateNextOccurrence } from "@/lib/recurrence-service";
import { logActivity, ActivityAction } from "@/lib/activity";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { userId } = await requireUser(request);
    const { id } = await context.params;

    const todo = await prisma.todo.findFirst({
      where: { id, userId },
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
  try {
    const { userId } = await requireUser(request);
    const { id } = await context.params;
    const body = await request.json();
    const parsed = UpdateTodoSchema.safeParse(body);

    if (!parsed.success) {
      throw ApiError.badRequest("Validation failed", parsed.error.issues);
    }

    const existing = await prisma.todo.findFirst({
      where: { id, userId },
      include: {
        children: { select: { id: true } },
        tags: { select: { tagId: true } },
      },
    });
    if (!existing) {
      throw ApiError.notFound("Todo not found");
    }

    const { tagIds, ...updateData } = parsed.data;

    if (updateData.categoryId) {
      const category = await prisma.category.findFirst({
        where: { id: updateData.categoryId, userId },
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
        where: { id: updateData.parentId, userId },
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
        where: { id: { in: tagIds }, userId },
      });
      if (tags.length !== tagIds.length) {
        throw ApiError.badRequest("One or more tags not found");
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
        userId,
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

    return successResponse(formatTodo(todo));
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
  }
}

export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { userId } = await requireUser(request);
    const { id } = await context.params;

    const existing = await prisma.todo.findFirst({ where: { id, userId } });
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
