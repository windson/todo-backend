import type { Prisma, PrismaClient } from "@prisma/client";

/** A Prisma client (or transaction client) that can write activity rows. */
type ActivityWriter = Pick<PrismaClient, "activityLog">;

/**
 * The set of activity actions the app records. Kept as a const object (rather
 * than a Prisma enum) so new features can add actions without a migration;
 * `action` is a free-form String column in the schema.
 */
export const ActivityAction = {
  TODO_CREATED: "todo.created",
  TODO_UPDATED: "todo.updated",
  TODO_COMPLETED: "todo.completed",
  TODO_UNCOMPLETED: "todo.uncompleted",
  TODO_DELETED: "todo.deleted",
  COMMENT_CREATED: "comment.created",
  COMMENT_UPDATED: "comment.updated",
  COMMENT_DELETED: "comment.deleted",
  ATTACHMENT_ADDED: "attachment.added",
  ATTACHMENT_REMOVED: "attachment.removed",
  REMINDER_CREATED: "reminder.created",
  REMINDER_DELETED: "reminder.deleted",
  REMINDER_DISPATCHED: "reminder.dispatched",
} as const;

export type ActivityActionValue =
  (typeof ActivityAction)[keyof typeof ActivityAction];

export interface LogActivityInput {
  /** The todo the activity relates to. */
  todoId: string;
  /** The user who performed the action. */
  userId: string;
  /** What happened (use an ActivityAction value). */
  action: ActivityActionValue | string;
  /** Optional structured detail about the change. */
  metadata?: Prisma.InputJsonValue;
}

/**
 * Append an entry to a todo's activity log. This is the single reusable writer
 * any route (todo CRUD, comments, attachments, and future features such as
 * sharing in FEAT-008) should call so the activity trail stays consistent.
 *
 * Writing is best-effort: a logging failure must never break the primary
 * operation, so errors are swallowed (and surfaced to the console in dev).
 * Pass a transaction client as `client` to log atomically with the change.
 */
export async function logActivity(
  client: ActivityWriter,
  input: LogActivityInput
): Promise<void> {
  try {
    await client.activityLog.create({
      data: {
        todoId: input.todoId,
        userId: input.userId,
        action: input.action,
        metadata: input.metadata,
      },
    });
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("Failed to write activity log entry", error);
    }
  }
}
