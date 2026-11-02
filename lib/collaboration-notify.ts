import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";

/** A Prisma client (or transaction client) that can write notifications. */
type NotificationWriter = Pick<PrismaClient, "notification">;

/**
 * Notification types produced by sharing & collaboration (FEAT-008). The
 * frontend maps these to human-readable titles in its notifications bell.
 */
export const CollaborationNotificationType = {
  TODO_SHARED: "todo.shared",
  TODO_ASSIGNED: "todo.assigned",
} as const;

/**
 * Write an in-app notification telling a user a todo was shared with them. This
 * is best-effort: a failure here must never break the primary share operation,
 * so errors are swallowed (surfaced to the console in dev).
 */
export async function notifyShared(
  userId: string,
  todoId: string,
  todoTitle: string | null | undefined,
  role: string,
  client: NotificationWriter = prisma
): Promise<void> {
  const payload: Prisma.InputJsonValue = {
    todoId,
    todoTitle: todoTitle ?? undefined,
    role,
  };
  try {
    await client.notification.create({
      data: { userId, type: CollaborationNotificationType.TODO_SHARED, payload },
    });
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("Failed to write share notification", error);
    }
  }
}

/**
 * Write an in-app notification telling a user a todo was assigned to them.
 * Best-effort, like notifyShared.
 */
export async function notifyAssigned(
  userId: string,
  todoId: string,
  todoTitle: string | null | undefined,
  client: NotificationWriter = prisma
): Promise<void> {
  const payload: Prisma.InputJsonValue = {
    todoId,
    todoTitle: todoTitle ?? undefined,
  };
  try {
    await client.notification.create({
      data: { userId, type: CollaborationNotificationType.TODO_ASSIGNED, payload },
    });
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("Failed to write assignment notification", error);
    }
  }
}
