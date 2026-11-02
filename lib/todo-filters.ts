/**
 * Pure helpers for building the smart-list due-date filters used by
 * GET /api/todos. Kept free of Prisma imports so they unit-test without a DB;
 * the returned object is shaped to drop straight into a Prisma DateTime filter.
 */

export type DueFilter = "today" | "upcoming" | "overdue";

/** A Prisma-compatible DateTime range filter. */
export interface DueDateRange {
  gte?: Date;
  lte?: Date;
  lt?: Date;
  gt?: Date;
}

/** Start of the given day (00:00:00.000) in local time, as a new Date. */
export function startOfDay(date: Date): Date {
  const d = new Date(date.getTime());
  d.setHours(0, 0, 0, 0);
  return d;
}

/** End of the given day (23:59:59.999) in local time, as a new Date. */
export function endOfDay(date: Date): Date {
  const d = new Date(date.getTime());
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Translate a smart-list `dueFilter` into a due-date range relative to `now`:
 * - today: due between the start and end of today.
 * - upcoming: due from the start of tomorrow onward (future todos).
 * - overdue: due strictly before the start of today.
 *
 * The caller merges the result into an existing `dueDate` where-clause.
 */
export function buildDueDateFilter(filter: DueFilter, now: Date = new Date()): DueDateRange {
  const todayStart = startOfDay(now);

  switch (filter) {
    case "today":
      return { gte: todayStart, lte: endOfDay(now) };
    case "upcoming": {
      const tomorrowStart = new Date(todayStart.getTime());
      tomorrowStart.setDate(tomorrowStart.getDate() + 1);
      return { gte: tomorrowStart };
    }
    case "overdue":
      return { lt: todayStart };
    default: {
      const _exhaustive: never = filter;
      return _exhaustive;
    }
  }
}
