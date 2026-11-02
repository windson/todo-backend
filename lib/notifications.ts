import type { Prisma, PrismaClient, Reminder } from "@prisma/client";
import { logActivity, ActivityAction } from "./activity";

/**
 * A Prisma client (or transaction client) the dispatcher needs: it reads due
 * reminders, writes in-app notification rows, and stamps reminders as sent.
 */
export type NotificationClient = Pick<
  PrismaClient,
  "reminder" | "notification" | "activityLog"
>;

/** The notification event a transport is asked to deliver. */
export interface NotificationEvent {
  /** The user who should receive the notification. */
  userId: string;
  /** The todo the reminder is for. */
  todoId: string;
  /** Short title of the todo (for display in the notification). */
  todoTitle?: string | null;
  /** When the reminder was scheduled for. */
  remindAt: Date;
  /** A free-form event type stored on the Notification row (e.g. reminder.due). */
  type: string;
}

/**
 * A delivery transport. Each channel (in-app, email, push) implements this.
 * `isConfigured` lets a transport opt out when its provider env vars are unset
 * so delivery becomes a no-op/log instead of an error - external providers are
 * not reachable in the sandbox and must never fail the dispatch request.
 */
export interface NotificationTransport {
  readonly channel: string;
  /** Whether this transport is configured and should attempt real delivery. */
  isConfigured(): boolean;
  /** Deliver the event. Must not throw for the common unconfigured case. */
  deliver(client: NotificationClient, event: NotificationEvent): Promise<void>;
}

/**
 * In-app transport: always configured. Writes a Notification row that the
 * frontend surfaces in its notifications bell.
 */
export const inAppTransport: NotificationTransport = {
  channel: "INAPP",
  isConfigured() {
    return true;
  },
  async deliver(client, event) {
    const payload: Prisma.InputJsonValue = {
      todoId: event.todoId,
      todoTitle: event.todoTitle ?? undefined,
      remindAt: event.remindAt.toISOString(),
      channel: this.channel,
    };
    await client.notification.create({
      data: { userId: event.userId, type: event.type, payload },
    });
  },
};

/**
 * Email transport. Gated behind EMAIL env config (e.g. an SMTP/provider API
 * key). When unconfigured it logs and no-ops so dispatch never fails. The real
 * provider call is intentionally left as a documented stub because external
 * providers are not reachable in the sandbox.
 */
export const emailTransport: NotificationTransport = {
  channel: "EMAIL",
  isConfigured() {
    return Boolean(process.env.EMAIL_PROVIDER_API_KEY && process.env.EMAIL_FROM);
  },
  async deliver(_client, event) {
    if (!this.isConfigured()) {
      if (process.env.NODE_ENV !== "production") {
        console.info(
          `[notifications] email transport not configured; skipping reminder for todo ${event.todoId}`
        );
      }
      return;
    }
    // Production wiring stub: send via the configured email provider here.
    // Left unimplemented on purpose - no outbound network in the sandbox.
    if (process.env.NODE_ENV !== "production") {
      console.info(
        `[notifications] (stub) would email user ${event.userId} about todo ${event.todoId}`
      );
    }
  },
};

/**
 * Push transport. Gated behind PUSH env config. Same no-op/log behaviour as the
 * email transport when unconfigured.
 */
export const pushTransport: NotificationTransport = {
  channel: "PUSH",
  isConfigured() {
    return Boolean(process.env.PUSH_PROVIDER_API_KEY);
  },
  async deliver(_client, event) {
    if (!this.isConfigured()) {
      if (process.env.NODE_ENV !== "production") {
        console.info(
          `[notifications] push transport not configured; skipping reminder for todo ${event.todoId}`
        );
      }
      return;
    }
    // Production wiring stub: send via the configured push provider here.
    if (process.env.NODE_ENV !== "production") {
      console.info(
        `[notifications] (stub) would push to user ${event.userId} about todo ${event.todoId}`
      );
    }
  },
};

/** The transport registry keyed by Reminder.channel. */
export const transports: Record<string, NotificationTransport> = {
  INAPP: inAppTransport,
  EMAIL: emailTransport,
  PUSH: pushTransport,
};

/** The notification `type` written for a due reminder. */
export const REMINDER_DUE_TYPE = "reminder.due";

export interface DispatchResult {
  /** How many due reminders were processed. */
  dispatched: number;
  /** The ids of the reminders that were marked sent. */
  reminderIds: string[];
}

type DueReminder = Reminder & {
  todo?: { title: string } | null;
};

/**
 * Find reminders that are due (remindAt <= now and not yet sent) and deliver
 * each over its channel's transport, then stamp sentAt. In-app delivery writes
 * a Notification row; email/push no-op when unconfigured. Best-effort per
 * reminder: a transport failure is logged and the reminder is left unsent so a
 * later run can retry, rather than failing the whole batch.
 *
 * In production this is driven by an external scheduler/cron calling the
 * /api/reminders/dispatch endpoint; there is no in-process scheduler.
 */
export async function dispatchDueReminders(
  client: NotificationClient,
  now: Date = new Date(),
  registry: Record<string, NotificationTransport> = transports
): Promise<DispatchResult> {
  const due = (await client.reminder.findMany({
    where: { sentAt: null, remindAt: { lte: now } },
    include: { todo: { select: { title: true } } },
    orderBy: { remindAt: "asc" },
  })) as DueReminder[];

  const reminderIds: string[] = [];

  for (const reminder of due) {
    const transport = registry[reminder.channel] ?? inAppTransport;
    const event: NotificationEvent = {
      userId: reminder.userId,
      todoId: reminder.todoId,
      todoTitle: reminder.todo?.title ?? null,
      remindAt: reminder.remindAt,
      type: REMINDER_DUE_TYPE,
    };

    try {
      await transport.deliver(client, event);
      await client.reminder.update({
        where: { id: reminder.id },
        data: { sentAt: now },
      });
      await logActivity(client, {
        todoId: reminder.todoId,
        userId: reminder.userId,
        action: ActivityAction.REMINDER_DISPATCHED,
        metadata: { reminderId: reminder.id, channel: reminder.channel },
      });
      reminderIds.push(reminder.id);
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.error(
          `[notifications] failed to dispatch reminder ${reminder.id}`,
          error
        );
      }
    }
  }

  return { dispatched: reminderIds.length, reminderIds };
}
