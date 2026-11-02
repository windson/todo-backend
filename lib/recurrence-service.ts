import type { Prisma, PrismaClient, RecurrenceRule } from "@prisma/client";
import { computeNextOccurrence } from "@/lib/recurrence";

/**
 * The subset of a Todo this service needs in order to spawn the next
 * occurrence. A record loaded with `include: { tags: true }` satisfies it.
 */
export interface RecurrenceSource {
  id: string;
  title: string;
  description: string | null;
  priority: Prisma.TodoCreateInput["priority"];
  startDate: Date | null;
  dueDate: Date | null;
  recurrenceRule: RecurrenceRule | null;
  recurrenceInterval: number;
  recurrenceGeneratedId: string | null;
  userId: string;
  categoryId: string | null;
  parentId: string | null;
  tags?: { tagId: string }[];
}

/** A Prisma client or interactive-transaction client that can create todos. */
type TodoWriter = Pick<PrismaClient, "todo">;

/**
 * When a recurring todo is completed, create its next occurrence.
 *
 * Idempotency: generation only happens when `recurrenceGeneratedId` is null, so
 * completing an already-completed recurring todo again is a no-op. The source
 * todo is stamped with the new occurrence's id. The spawned occurrence copies
 * the title, description, priority, category, parent, and tags of the source,
 * carries over the same recurrence rule/interval (so the chain continues), is
 * created as not-completed, and gets start/due dates advanced by the rule.
 *
 * Returns the created occurrence's id, or null when nothing was generated
 * (not recurring, already generated, or no dates to advance).
 */
export async function generateNextOccurrence(
  client: TodoWriter,
  source: RecurrenceSource
): Promise<string | null> {
  if (!source.recurrenceRule) {
    return null;
  }
  // Already spawned for this instance: avoid duplicates on re-completion.
  if (source.recurrenceGeneratedId) {
    return null;
  }

  const next = computeNextOccurrence(
    { startDate: source.startDate, dueDate: source.dueDate },
    source.recurrenceRule,
    source.recurrenceInterval
  );
  if (!next) {
    return null;
  }

  const tagIds = (source.tags ?? []).map((t) => t.tagId);

  const created = await client.todo.create({
    data: {
      title: source.title,
      description: source.description,
      priority: source.priority,
      startDate: next.startDate,
      dueDate: next.dueDate,
      completed: false,
      recurrenceRule: source.recurrenceRule,
      recurrenceInterval: source.recurrenceInterval,
      userId: source.userId,
      categoryId: source.categoryId,
      parentId: source.parentId,
      tags: tagIds.length > 0 ? { create: tagIds.map((tagId) => ({ tagId })) } : undefined,
    },
  });

  // Stamp the source so re-completing it does not spawn another occurrence.
  await client.todo.update({
    where: { id: source.id },
    data: { recurrenceGeneratedId: created.id },
  });

  return created.id;
}
