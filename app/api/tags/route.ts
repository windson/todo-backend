import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, createdResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { CreateTagSchema } from "@/lib/validation";

export async function GET() {
  try {
    const tags = await prisma.tag.findMany({
      include: {
        _count: { select: { todos: true } },
      },
      orderBy: { name: "asc" },
    });

    const formattedTags = tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
      usageCount: tag._count.todos,
    }));

    return successResponse(formattedTags);
  } catch (error) {
    return errorResponse(error instanceof ApiError ? error : ApiError.internal());
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = CreateTagSchema.safeParse(body);

    if (!parsed.success) {
      throw ApiError.badRequest("Validation failed", parsed.error.issues);
    }

    const existing = await prisma.tag.findUnique({
      where: { name: parsed.data.name },
    });
    if (existing) {
      throw ApiError.conflict("A tag with this name already exists");
    }

    const tag = await prisma.tag.create({
      data: parsed.data,
    });

    return createdResponse(tag);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
  }
}
