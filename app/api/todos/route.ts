import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, createdResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { CreateTodoSchema, TodoQueryParamsSchema } from "@/lib/validation";
import { requireUser } from "@/lib/auth";
import { formatTodo, todoInclude } from "@/lib/todo-format";
import { buildDueDateFilter } from "@/lib/todo-filters";
import { logActivity, ActivityAction } from "@/lib/activity";
import { accessibleTodoWhere } from "@/lib/todo-access";
import { paginationHeaders } from "@/lib/pagination";
import { logRequest } from "@/lib/request-log";
import { Prisma } from "@prisma/client";

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  let currentUserId: string | null = null;
  try {
    const { userId } = await requireUser(request);
    currentUserId = userId;
    const { searchParams } = new URL(request.url);
    const params = Object.fromEntries(searchParams.entries());

    const parsed = TodoQueryParamsSchema.safeParse(params);
    if (!parsed.success) {
      throw ApiError.badRequest("Invalid query parameters", parsed.error.issues);
    }

    const {
      search,
      completed,
      priority,
      categoryId,
      tagId,
      parentId,
      includeSubtasks,
      assigneeId,
      sharedWithMe,
      dueBefore,
      dueAfter,
      dueFilter,
      sortBy = "createdAt",
      sortOrder = "desc",
      limit = 20,
      offset = 0,
    } = parsed.data;

    // Base scoping: the list shows todos the user OWNS or that are SHARED with
    // them (never unrelated todos). `sharedWithMe` narrows that set:
    // - "true"  -> only todos shared with the user (not owned)
    // - "false" -> only owned todos
    // - omitted -> owned + shared (the default accessible set)
    let where: Prisma.TodoWhereInput;
    if (sharedWithMe === "true") {
      where = { userId: { not: userId }, shares: { some: { userId } } };
    } else if (sharedWithMe === "false") {
      where = { userId };
    } else {
      where = accessibleTodoWhere(userId);
    }

    // Subtask scoping:
    // - `parentId=<id>` lists the children of a specific todo.
    // - default (no parentId, includeSubtasks!=true) returns only top-level
    //   todos so nested subtasks don't appear twice in the list.
    // - `includeSubtasks=true` returns a flat list including subtasks.
    if (parentId !== undefined) {
      where.parentId = parentId;
    } else if (includeSubtasks !== "true") {
      where.parentId = null;
    }

    if (search) {
      // Combine the search terms with the existing access-scoping clause under
      // `AND` instead of overwriting `where.OR`. Overwriting `OR` would drop the
      // owner/share tenant-scope from accessibleTodoWhere and leak other users'
      // todos for any `?search=` request.
      const searchClause: Prisma.TodoWhereInput = {
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
        ],
      };
      where.AND = where.AND
        ? [...(Array.isArray(where.AND) ? where.AND : [where.AND]), searchClause]
        : [searchClause];
    }

    if (completed !== undefined) {
      where.completed = completed === "true";
    }

    if (priority) {
      const priorities = priority.split(",");
      where.priority = { in: priorities as Prisma.EnumPriorityFilter["in"] };
    }

    if (categoryId) {
      where.categoryId = categoryId;
    }

    if (assigneeId) {
      where.assigneeId = assigneeId;
    }

    if (tagId) {
      where.tags = { some: { tagId } };
    }

    // Smart-list due-date filters (today/upcoming/overdue) layer on top of the
    // explicit dueBefore/dueAfter range. All share the single `dueDate` clause.
    if (dueBefore || dueAfter || dueFilter) {
      const dueDate: Prisma.DateTimeNullableFilter = {};
      if (dueBefore) dueDate.lte = dueBefore;
      if (dueAfter) dueDate.gte = dueAfter;
      if (dueFilter) {
        Object.assign(dueDate, buildDueDateFilter(dueFilter));
      }
      where.dueDate = dueDate;
    }

    const orderBy: Prisma.TodoOrderByWithRelationInput[] =
      sortBy === "priority"
        ? [{ priority: sortOrder }]
        : sortBy === "dueDate"
          ? [{ dueDate: sortOrder }]
          : sortBy === "title"
            ? [{ title: sortOrder }]
            : sortBy === "order"
              ? [{ order: sortOrder }, { createdAt: "desc" }]
              : [{ createdAt: sortOrder }];

    const [todos, totalCount] = await Promise.all([
      prisma.todo.findMany({
        where,
        orderBy,
        take: limit,
        skip: offset,
        include: todoInclude,
      }),
      prisma.todo.count({ where }),
    ]);

    const formattedTodos = todos.map((todo) => formatTodo(todo));

    // Emit X-Total-Count plus RFC 5988 Link headers (first/prev/next/last) so
    // clients can navigate pages without recomputing offsets. Both are
    // CORS-exposed via middleware.
    const headers = paginationHeaders({
      url: request.url,
      limit,
      offset,
      total: totalCount,
    });

    const response = successResponse(formattedTodos, 200, headers);
    logRequest({
      method: "GET",
      path: "/api/todos",
      status: 200,
      durationMs: Math.round(Date.now() - startedAt),
      userId: currentUserId,
    });
    return response;
  } catch (error) {
    const response =
      error instanceof ApiError ? errorResponse(error) : errorResponse(ApiError.internal());
    logRequest({
      method: "GET",
      path: "/api/todos",
      status: response.status,
      durationMs: Math.round(Date.now() - startedAt),
      userId: currentUserId,
    });
    return response;
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireUser(request);
    const body = await request.json();
    const parsed = CreateTodoSchema.safeParse(body);

    if (!parsed.success) {
      throw ApiError.badRequest("Validation failed", parsed.error.issues);
    }

    const { tagIds, ...todoData } = parsed.data;

    if (todoData.categoryId) {
      const category = await prisma.category.findFirst({
        where: { id: todoData.categoryId, userId },
      });
      if (!category) {
        throw ApiError.badRequest("Category not found");
      }
    }

    if (todoData.parentId) {
      const parent = await prisma.todo.findFirst({
        where: { id: todoData.parentId, userId },
      });
      if (!parent) {
        throw ApiError.badRequest("Parent todo not found");
      }
      // Only one level of nesting: a subtask cannot itself have children.
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

    // On create the todo has no shares yet, so the only assignable user is the
    // owner (the creator). Reject any other assignee to keep the invariant that
    // an assignee owns or is shared on the todo.
    if (todoData.assigneeId && todoData.assigneeId !== userId) {
      throw ApiError.badRequest(
        "Assignee must be the owner or a user the todo is shared with"
      );
    }

    const todo = await prisma.todo.create({
      data: {
        ...todoData,
        userId,
        tags: tagIds
          ? { create: tagIds.map((tagId) => ({ tagId })) }
          : undefined,
      },
      include: todoInclude,
    });

    await logActivity(prisma, {
      todoId: todo.id,
      userId,
      action: ActivityAction.TODO_CREATED,
      metadata: { title: todo.title },
    });

    if (todo.assigneeId) {
      await logActivity(prisma, {
        todoId: todo.id,
        userId,
        action: ActivityAction.TODO_ASSIGNED,
        metadata: { assigneeId: todo.assigneeId },
      });
    }

    return createdResponse(formatTodo(todo));
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
  }
}
