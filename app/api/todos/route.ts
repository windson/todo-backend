import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, createdResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { CreateTodoSchema, TodoQueryParamsSchema } from "@/lib/validation";
import { Prisma } from "@prisma/client";

export async function GET(request: NextRequest) {
  try {
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
      dueBefore,
      dueAfter,
      sortBy = "createdAt",
      sortOrder = "desc",
      limit = 20,
      offset = 0,
    } = parsed.data;

    const where: Prisma.TodoWhereInput = {};

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

    if (dueBefore || dueAfter) {
      where.dueDate = {};
      if (dueBefore) where.dueDate.lte = dueBefore;
      if (dueAfter) where.dueDate.gte = dueAfter;
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
        include: {
          category: true,
          tags: { include: { tag: true } },
        },
      }),
      prisma.todo.count({ where }),
    ]);

    const formattedTodos = todos.map((todo) => ({
      ...todo,
      tags: todo.tags.map((tt) => tt.tag),
    }));

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
    const body = await request.json();
    const parsed = CreateTodoSchema.safeParse(body);

    if (!parsed.success) {
      throw ApiError.badRequest("Validation failed", parsed.error.issues);
    }

    const { tagIds, ...todoData } = parsed.data;

    if (todoData.categoryId) {
      const category = await prisma.category.findUnique({
        where: { id: todoData.categoryId },
      });
      if (!category) {
        throw ApiError.badRequest("Category not found");
      }
    }

    const todo = await prisma.todo.create({
      data: {
        ...todoData,
        tags: tagIds
          ? { create: tagIds.map((tagId) => ({ tagId })) }
          : undefined,
      },
      include: {
        category: true,
        tags: { include: { tag: true } },
      },
    });

    const formattedTodo = {
      ...todo,
      tags: todo.tags.map((tt) => tt.tag),
    };

    return createdResponse(formattedTodo);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
  }
}
