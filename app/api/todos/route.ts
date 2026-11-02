import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, createdResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { CreateTodoSchema, TodoQueryParamsSchema } from "@/lib/validation";
import { requireUser } from "@/lib/auth";
import { formatTodo, todoInclude } from "@/lib/todo-format";
import { buildDueDateFilter } from "@/lib/todo-filters";
import { Prisma } from "@prisma/client";

export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireUser(request);
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
      dueBefore,
      dueAfter,
      dueFilter,
      sortBy = "createdAt",
      sortOrder = "desc",
      limit = 20,
      offset = 0,
    } = parsed.data;

    const where: Prisma.TodoWhereInput = { userId };

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
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
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

    const orderBy: Prisma.TodoOrderByWithRelationInput = {};
    if (sortBy === "priority") {
      orderBy.priority = sortOrder;
    } else if (sortBy === "dueDate") {
      orderBy.dueDate = sortOrder;
    } else if (sortBy === "title") {
      orderBy.title = sortOrder;
    } else {
      orderBy.createdAt = sortOrder;
    }

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

    return successResponse(formattedTodos, 200, {
      "X-Total-Count": totalCount.toString(),
    });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
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

    return createdResponse(formatTodo(todo));
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
  }
}
