import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, createdResponse, errorResponse } from "@/lib/api-response";
import { ApiError } from "@/lib/errors";
import { CreateShareSchema } from "@/lib/validation";
import { requireUser } from "@/lib/auth";
import { requireTodoRead, requireTodoManage } from "@/lib/todo-access";
import { logActivity, ActivityAction } from "@/lib/activity";
import { notifyShared } from "@/lib/collaboration-notify";

type RouteContext = { params: Promise<{ id: string }> };

const shareUserSelect = { id: true, email: true, name: true } as const;

/** List the shares on a todo. Any user who can read the todo can see with whom it is shared. */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { userId } = await requireUser(request);
    const { id } = await context.params;

    await requireTodoRead(prisma, id, userId);

    const shares = await prisma.todoShare.findMany({
      where: { todoId: id },
      orderBy: { createdAt: "asc" },
      include: { user: { select: shareUserSelect } },
    });

    return successResponse(shares);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
  }
}

/**
 * Share a todo with another user by EXACT email. Only the owner may share.
 * Idempotent-ish: re-sharing the same user updates their role.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { userId } = await requireUser(request);
    const { id } = await context.params;
    const body = await request.json();
    const parsed = CreateShareSchema.safeParse(body);

    if (!parsed.success) {
      throw ApiError.badRequest("Validation failed", parsed.error.issues);
    }

    // Only the owner may share a todo.
    const access = await requireTodoManage(prisma, id, userId);

    const role = parsed.data.role ?? "VIEWER";

    // Resolve the invitee by exact email. Returns 404 rather than revealing
    // whether an account exists via a more specific message.
    // Emails are stored lowercased at signup, so normalize the invite address
    // before the exact-email lookup — otherwise a differently-cased address
    // (e.g. "Foo@x.com") fails to resolve a real account stored as "foo@x.com".
    const invitee = await prisma.user.findUnique({
      where: { email: parsed.data.email.toLowerCase() },
      select: { id: true, email: true, name: true },
    });
    if (!invitee) {
      throw ApiError.notFound("No user found with that email");
    }

    // Cannot share a todo with its owner.
    if (invitee.id === access.ownerId) {
      throw ApiError.badRequest("You cannot share a todo with its owner");
    }

    const share = await prisma.todoShare.upsert({
      where: { todoId_userId: { todoId: id, userId: invitee.id } },
      create: { todoId: id, userId: invitee.id, role },
      update: { role },
      include: { user: { select: shareUserSelect } },
    });

    await logActivity(prisma, {
      todoId: id,
      userId,
      action: ActivityAction.TODO_SHARED,
      metadata: { sharedWithUserId: invitee.id, role },
    });

    // Load the todo title for the notification (owner already resolved access).
    const todo = await prisma.todo.findUnique({
      where: { id },
      select: { title: true },
    });
    await notifyShared(invitee.id, id, todo?.title, role);

    return createdResponse(share);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(ApiError.internal());
  }
}
