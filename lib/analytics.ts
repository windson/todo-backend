import type { PrismaClient } from "@prisma/client";

/**
 * Analytics scope decision (FEAT-009):
 * Analytics aggregates cover ONLY todos the user OWNS (where: { userId }), NOT
 * todos shared with them. This avoids double-counting a shared todo in both the
 * owner's and the collaborator's dashboards and keeps every user's metrics
 * reflecting their own backlog. (Contrast with export, which uses the same
 * owned-only scope for the same reason.)
 */

export const DEFAULT_TREND_DAYS = 30;

type AnalyticsReader = Pick<PrismaClient, "todo">;

export interface TrendPoint {
  /** Calendar day in YYYY-MM-DD (UTC). */
  date: string;
  /** Todos completed (updatedAt within the day, completed=true) that day. */
  completed: number;
  /** Todos created that day. */
  created: number;
}

export interface CountBucket {
  key: string;
  count: number;
}

export interface AnalyticsResult {
  /** Number of days covered by the trend window. */
  rangeDays: number;
  /** Inclusive start of the trend window (ISO), midnight UTC. */
  rangeStart: string;
  totals: {
    total: number;
    completed: number;
    active: number;
    overdue: number;
    completionRate: number;
  };
  byPriority: CountBucket[];
  byStatus: CountBucket[];
  byCategory: CountBucket[];
  trend: TrendPoint[];
}

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

/** Midnight (UTC) of the given date, as a new Date. */
function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

/** Format a Date as YYYY-MM-DD in UTC. */
function toDayKey(date: Date): string {
  return startOfUtcDay(date).toISOString().slice(0, 10);
}

/**
 * Compute per-user productivity analytics over the owned todos. `days` sets the
 * completion-trend window (defaults to 30). All queries are scoped to `userId`
 * (owned-only, see the scope note above) and the date math is UTC-based.
 */
export async function computeAnalytics(
  client: AnalyticsReader,
  userId: string,
  days: number = DEFAULT_TREND_DAYS,
  now: Date = new Date()
): Promise<AnalyticsResult> {
  const rangeStart = startOfUtcDay(now);
  rangeStart.setUTCDate(rangeStart.getUTCDate() - (days - 1));

  const where = { userId };

  const [
    total,
    completed,
    overdue,
    priorityGroups,
    categoryGroups,
    recentCompleted,
    recentCreated,
  ] = await Promise.all([
    client.todo.count({ where }),
    client.todo.count({ where: { ...where, completed: true } }),
    client.todo.count({
      where: { ...where, completed: false, dueDate: { lt: now } },
    }),
    client.todo.groupBy({
      by: ["priority"],
      where,
      _count: { _all: true },
    }),
    client.todo.groupBy({
      by: ["categoryId"],
      where,
      _count: { _all: true },
    }),
    // Completed todos whose last update lands in the window: we approximate the
    // completion date with updatedAt (a completed todo's most recent change).
    client.todo.findMany({
      where: { ...where, completed: true, updatedAt: { gte: rangeStart } },
      select: { updatedAt: true },
    }),
    client.todo.findMany({
      where: { ...where, createdAt: { gte: rangeStart } },
      select: { createdAt: true },
    }),
  ]);

  const active = total - completed;
  const completionRate = total === 0 ? 0 : Math.round((completed / total) * 1000) / 1000;

  // Priority buckets in a stable order, zero-filled for missing priorities.
  const priorityCounts = new Map<string, number>();
  for (const group of priorityGroups as Array<{ priority: string; _count: { _all: number } }>) {
    priorityCounts.set(group.priority, group._count._all);
  }
  const byPriority: CountBucket[] = PRIORITIES.map((p) => ({
    key: p,
    count: priorityCounts.get(p) ?? 0,
  }));

  const byStatus: CountBucket[] = [
    { key: "completed", count: completed },
    { key: "active", count: active },
    { key: "overdue", count: overdue },
  ];

  const byCategory: CountBucket[] = (
    categoryGroups as Array<{ categoryId: string | null; _count: { _all: number } }>
  ).map((group) => ({
    key: group.categoryId ?? "uncategorized",
    count: group._count._all,
  }));

  // Build a zero-filled per-day trend across the window.
  const trendMap = new Map<string, TrendPoint>();
  for (let d = 0; d < days; d++) {
    const day = new Date(rangeStart);
    day.setUTCDate(day.getUTCDate() + d);
    const key = toDayKey(day);
    trendMap.set(key, { date: key, completed: 0, created: 0 });
  }
  for (const row of recentCompleted as Array<{ updatedAt: Date }>) {
    const point = trendMap.get(toDayKey(row.updatedAt));
    if (point) point.completed += 1;
  }
  for (const row of recentCreated as Array<{ createdAt: Date }>) {
    const point = trendMap.get(toDayKey(row.createdAt));
    if (point) point.created += 1;
  }
  const trend = Array.from(trendMap.values());

  return {
    rangeDays: days,
    rangeStart: rangeStart.toISOString(),
    totals: { total, completed, active, overdue, completionRate },
    byPriority,
    byStatus,
    byCategory,
    trend,
  };
}
