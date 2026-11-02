/**
 * The supported recurrence frequencies. Mirrors the Prisma `RecurrenceRule`
 * enum but is declared independently here so this module stays pure (no Prisma
 * import) and unit-testable without a database.
 */
export type RecurrenceRule = "DAILY" | "WEEKLY" | "MONTHLY";

export const RECURRENCE_RULES: readonly RecurrenceRule[] = ["DAILY", "WEEKLY", "MONTHLY"];

/**
 * Advance a single date by `interval` units of the given recurrence rule.
 * Returns a new Date and never mutates the input. Monthly steps clamp to the
 * last day of the target month (e.g. Jan 31 + 1 month -> Feb 28/29).
 */
export function advanceDate(date: Date, rule: RecurrenceRule, interval: number): Date {
  const step = Number.isFinite(interval) && interval >= 1 ? Math.floor(interval) : 1;
  const result = new Date(date.getTime());

  switch (rule) {
    case "DAILY":
      result.setDate(result.getDate() + step);
      return result;
    case "WEEKLY":
      result.setDate(result.getDate() + step * 7);
      return result;
    case "MONTHLY": {
      const day = result.getDate();
      // Move to the first of the month before shifting to avoid JS rolling
      // over into the following month when the target month is shorter.
      result.setDate(1);
      result.setMonth(result.getMonth() + step);
      const daysInTargetMonth = new Date(
        result.getFullYear(),
        result.getMonth() + 1,
        0
      ).getDate();
      result.setDate(Math.min(day, daysInTargetMonth));
      return result;
    }
    default: {
      // Exhaustiveness guard: unreachable for valid RecurrenceRule values.
      const _exhaustive: never = rule;
      return _exhaustive;
    }
  }
}

export interface OccurrenceDates {
  startDate: Date | null;
  dueDate: Date | null;
}

/**
 * Compute the start/due dates of the NEXT occurrence of a recurring todo.
 *
 * Both dates are advanced by the same amount so the duration between start and
 * due is preserved. A null date stays null (e.g. a recurring todo with only a
 * due date yields a next occurrence with only a due date).
 *
 * Returns `null` when neither date is set, since there is nothing meaningful to
 * advance and the caller should not generate an occurrence in that case.
 */
export function computeNextOccurrence(
  current: OccurrenceDates,
  rule: RecurrenceRule,
  interval: number
): OccurrenceDates | null {
  if (current.startDate === null && current.dueDate === null) {
    return null;
  }

  return {
    startDate: current.startDate ? advanceDate(current.startDate, rule, interval) : null,
    dueDate: current.dueDate ? advanceDate(current.dueDate, rule, interval) : null,
  };
}
