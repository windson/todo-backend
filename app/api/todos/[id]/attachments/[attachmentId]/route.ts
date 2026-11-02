import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { requireUser } from "@/lib/auth";
import { logActivity, ActivityAction } from "@/lib/activity";

type RouteContext = { params: Promise<{ id: string; attachmentId: string }> };

/** Remove an attachment reference from a todo (owner-scoped). */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { userId } = await requireUser(request);
    const { id, attachmentId } = await context.params;

    const todo = await prisma.todo.findFirst({ where: { id, userId } });
    if (!todo) {
      throw ApiError.notFound("Todo not found");
    }

    const attachment = await prisma.attachment.findFirst({
      where: { id: attachmentId, todoId: id },
    });
    if (!attachment) {
      throw ApiError.notFound("Attachment not found");
    }

    await prisma.attachment.delete({ where: { id: attachmentId } });

    await logActivity(prisma, {
      todoId: id,
      userId,
      action: ActivityAction.ATTACHMENT_REMOVED,
      metadata: { attachmentId, filename: attachment.filename },
    });

    return successResponse({ message: "Attachment deleted successfully" });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
  }
}
