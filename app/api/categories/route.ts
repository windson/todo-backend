import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, createdResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { CreateCategorySchema } from "@/lib/validation";
import { requireUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireUser(request);
    const categories = await prisma.category.findMany({
      where: { userId },
      include: {
        _count: { select: { todos: true } },
      },
      orderBy: { name: "asc" },
    });

    const formattedCategories = categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      color: cat.color,
      createdAt: cat.createdAt,
      todoCount: cat._count.todos,
    }));

    return successResponse(formattedCategories);
  } catch (error) {
    return errorResponse(error instanceof ApiError ? error : ApiError.internal(undefined, error));
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireUser(request);
    const body = await request.json();
    const parsed = CreateCategorySchema.safeParse(body);

    if (!parsed.success) {
      throw ApiError.badRequest("Validation failed", parsed.error.issues);
    }

    const existing = await prisma.category.findFirst({
      where: { userId, name: parsed.data.name },
    });
    if (existing) {
      throw ApiError.conflict("A category with this name already exists");
    }

    const category = await prisma.category.create({
      data: { ...parsed.data, userId },
    });

    return createdResponse(category);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal(undefined, error));
  }
}
