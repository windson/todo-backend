import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, createdResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { CreateAttachmentSchema } from "@/lib/validation";
import { requireUser } from "@/lib/auth";
import { requireTodoRead, requireTodoWrite } from "@/lib/todo-access";
import { logActivity, ActivityAction } from "@/lib/activity";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * List the attachment references for a todo.
 *
 * NOTE: attachments are metadata-only. The sandbox has no object store or
 * outbound network, so these endpoints store a URL/filename REFERENCE rather
 * than accepting a binary upload. Wiring an actual upload (presigned URL to an
 * object store) is deferred and should be config-gated behind a storage flag.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { userId } = await requireUser(request);
    const { id } = await context.params;

    await requireTodoRead(prisma, id, userId);

    const attachments = await prisma.attachment.findMany({
      where: { todoId: id },
      orderBy: { createdAt: "desc" },
    });

    return successResponse(attachments);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
  }
}

/** Add an attachment reference (URL + filename metadata) to a todo. */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { userId } = await requireUser(request);
    const { id } = await context.params;
    const body = await request.json();
    const parsed = CreateAttachmentSchema.safeParse(body);

    if (!parsed.success) {
      throw ApiError.badRequest("Validation failed", parsed.error.issues);
    }

    await requireTodoWrite(prisma, id, userId);

    const attachment = await prisma.attachment.create({
      data: { ...parsed.data, todoId: id },
    });

    await logActivity(prisma, {
      todoId: id,
      userId,
      action: ActivityAction.ATTACHMENT_ADDED,
      metadata: { attachmentId: attachment.id, filename: attachment.filename },
    });

    return createdResponse(attachment);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
  }
}
