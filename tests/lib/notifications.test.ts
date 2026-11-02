import { describe, it, expect, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import {
  dispatchDueReminders,
  inAppTransport,
  emailTransport,
  pushTransport,
  type NotificationTransport,
} from "@/lib/notifications";

function makeClient() {
  // A standalone deep mock so these pure-dispatcher tests don't depend on the
  // route-level @/lib/prisma module mock.
  return mockDeep<PrismaClient>();
}

function makeReminder(overrides: Record<string, unknown> = {}) {
  return {
    id: "reminder-1",
    remindAt: new Date("2024-01-01T00:00:00.000Z"),
    channel: "INAPP",
    sentAt: null,
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    todoId: "todo-1",
    userId: "user-1",
    todo: { title: "Launch website" },
    ...overrides,
  };
}

describe("dispatchDueReminders", () => {
  it("selects only due, unsent reminders (remindAt <= now, sentAt null)", async () => {
    const client = makeClient();
    client.reminder.findMany.mockResolvedValue([makeReminder()] as never);

    const now = new Date("2024-02-01T00:00:00.000Z");
    await dispatchDueReminders(client, now);

    const whereArg = client.reminder.findMany.mock.calls[0][0];
    expect(whereArg.where).toEqual({ sentAt: null, remindAt: { lte: now } });
  });

  it("creates an in-app notification for a due INAPP reminder and stamps sentAt", async () => {
    const client = makeClient();
    client.reminder.findMany.mockResolvedValue([makeReminder()] as never);

    const now = new Date("2024-02-01T00:00:00.000Z");
    const result = await dispatchDueReminders(client, now);

    expect(client.notification.create).toHaveBeenCalledOnce();
    const notifArg = client.notification.create.mock.calls[0][0];
    expect(notifArg.data.userId).toBe("user-1");
    expect(notifArg.data.type).toBe("reminder.due");
    expect(notifArg.data.payload).toMatchObject({
      todoId: "todo-1",
      todoTitle: "Launch website",
      channel: "INAPP",
    });

    expect(client.reminder.update).toHaveBeenCalledWith({
      where: { id: "reminder-1" },
      data: { sentAt: now },
    });
    expect(result).toEqual({ dispatched: 1, reminderIds: ["reminder-1"] });
  });

  it("writes a reminder.dispatched activity entry", async () => {
    const client = makeClient();
    client.reminder.findMany.mockResolvedValue([makeReminder()] as never);

    await dispatchDueReminders(client, new Date());

    expect(client.activityLog.create).toHaveBeenCalledOnce();
    const activityArg = client.activityLog.create.mock.calls[0][0];
    expect(activityArg.data.action).toBe("reminder.dispatched");
  });

  it("uses the transport registry and mocks a custom transport", async () => {
    const client = makeClient();
    client.reminder.findMany.mockResolvedValue([makeReminder()] as never);

    const deliver = vi.fn().mockResolvedValue(undefined);
    const mockTransport: NotificationTransport = {
      channel: "INAPP",
      isConfigured: () => true,
      deliver,
    };

    const result = await dispatchDueReminders(client, new Date(), {
      INAPP: mockTransport,
    });

    expect(deliver).toHaveBeenCalledOnce();
    expect(result.dispatched).toBe(1);
    // The real in-app writer was replaced, so no notification row was written.
    expect(client.notification.create).not.toHaveBeenCalled();
  });

  it("leaves a reminder unsent when its transport throws (best-effort)", async () => {
    const client = makeClient();
    client.reminder.findMany.mockResolvedValue([makeReminder()] as never);

    const failing: NotificationTransport = {
      channel: "INAPP",
      isConfigured: () => true,
      deliver: vi.fn().mockRejectedValue(new Error("boom")),
    };

    const result = await dispatchDueReminders(client, new Date(), {
      INAPP: failing,
    });

    expect(result.dispatched).toBe(0);
    expect(client.reminder.update).not.toHaveBeenCalled();
  });

  it("does nothing when there are no due reminders", async () => {
    const client = makeClient();
    client.reminder.findMany.mockResolvedValue([] as never);

    const result = await dispatchDueReminders(client, new Date());

    expect(result).toEqual({ dispatched: 0, reminderIds: [] });
    expect(client.notification.create).not.toHaveBeenCalled();
  });
});

describe("transports are config-gated and do not throw when unconfigured", () => {
  const event = {
    userId: "user-1",
    todoId: "todo-1",
    todoTitle: "x",
    remindAt: new Date(),
    type: "reminder.due",
  };

  it("in-app transport is always configured", () => {
    expect(inAppTransport.isConfigured()).toBe(true);
  });

  it("email transport is not configured without env and no-ops", async () => {
    delete process.env.EMAIL_PROVIDER_API_KEY;
    delete process.env.EMAIL_FROM;
    expect(emailTransport.isConfigured()).toBe(false);
    const client = makeClient();
    await expect(emailTransport.deliver(client, event)).resolves.toBeUndefined();
    expect(client.notification.create).not.toHaveBeenCalled();
  });

  it("push transport is not configured without env and no-ops", async () => {
    delete process.env.PUSH_PROVIDER_API_KEY;
    expect(pushTransport.isConfigured()).toBe(false);
    const client = makeClient();
    await expect(pushTransport.deliver(client, event)).resolves.toBeUndefined();
    expect(client.notification.create).not.toHaveBeenCalled();
  });
});
