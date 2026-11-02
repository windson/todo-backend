import { describe, it, expect, type Mock } from "vitest";
import { prismaMock } from "../helpers/prisma-mock";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/analytics/route";
import { createToken } from "@/lib/auth";

const authToken = await createToken({
  userId: "user-1",
  email: "user@example.com",
});

function makeRequest(url: string): NextRequest {
  const headers = new Headers();
  headers.set("authorization", `Bearer ${authToken}`);
  return new NextRequest(new Request(url, { headers }));
}

/**
 * The analytics handler issues several count/groupBy/findMany calls via
 * Promise.all. These helpers stub them with deterministic values. count() is
 * called three times in order: total, completed, overdue.
 */
function stubAnalytics(opts: {
  total: number;
  completed: number;
  overdue: number;
  priorityGroups: Array<{ priority: string; _count: { _all: number } }>;
  categoryGroups: Array<{ categoryId: string | null; _count: { _all: number } }>;
  completedDates: Date[];
  createdDates: Date[];
}) {
  prismaMock.todo.count
    .mockResolvedValueOnce(opts.total)
    .mockResolvedValueOnce(opts.completed)
    .mockResolvedValueOnce(opts.overdue);
  const groupByMock = prismaMock.todo.groupBy as unknown as Mock;
  groupByMock
    .mockResolvedValueOnce(opts.priorityGroups)
    .mockResolvedValueOnce(opts.categoryGroups);
  prismaMock.todo.findMany
    .mockResolvedValueOnce(
      opts.completedDates.map((updatedAt) => ({ updatedAt })) as never
    )
    .mockResolvedValueOnce(
      opts.createdDates.map((createdAt) => ({ createdAt })) as never
    );
}

describe("GET /api/analytics", () => {
  it("returns per-user aggregates with the expected shape", async () => {
    const today = new Date();
    stubAnalytics({
      total: 10,
      completed: 4,
      overdue: 2,
      priorityGroups: [
        { priority: "HIGH", _count: { _all: 3 } },
        { priority: "LOW", _count: { _all: 7 } },
      ],
      categoryGroups: [
        { categoryId: "cat-1", _count: { _all: 6 } },
        { categoryId: null, _count: { _all: 4 } },
      ],
      completedDates: [today, today],
      createdDates: [today],
    });

    const res = await GET(makeRequest("http://localhost/api/analytics"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    const data = body.data;

    // Totals.
    expect(data.totals.total).toBe(10);
    expect(data.totals.completed).toBe(4);
    expect(data.totals.active).toBe(6);
    expect(data.totals.overdue).toBe(2);
    expect(data.totals.completionRate).toBeCloseTo(0.4, 5);

    // Priority breakdown is zero-filled and stably ordered.
    expect(data.byPriority).toEqual([
      { key: "LOW", count: 7 },
      { key: "MEDIUM", count: 0 },
      { key: "HIGH", count: 3 },
      { key: "URGENT", count: 0 },
    ]);

    // Status breakdown.
    expect(data.byStatus).toEqual([
      { key: "completed", count: 4 },
      { key: "active", count: 6 },
      { key: "overdue", count: 2 },
    ]);

    // Category breakdown maps null -> "uncategorized".
    expect(data.byCategory).toContainEqual({ key: "cat-1", count: 6 });
    expect(data.byCategory).toContainEqual({ key: "uncategorized", count: 4 });

    // Default 30-day window.
    expect(data.rangeDays).toBe(30);
    expect(data.trend).toHaveLength(30);
    // The final trend point is "today" and reflects the stubbed completions.
    const last = data.trend[data.trend.length - 1];
    expect(last.completed).toBe(2);
    expect(last.created).toBe(1);
  });

  it("honors the days query param", async () => {
    const today = new Date();
    stubAnalytics({
      total: 0,
      completed: 0,
      overdue: 0,
      priorityGroups: [],
      categoryGroups: [],
      completedDates: [today],
      createdDates: [],
    });

    const res = await GET(makeRequest("http://localhost/api/analytics?days=7"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.rangeDays).toBe(7);
    expect(body.data.trend).toHaveLength(7);
    expect(body.data.totals.completionRate).toBe(0);
  });

  it("rejects an out-of-range days param with a 400", async () => {
    const res = await GET(
      makeRequest("http://localhost/api/analytics?days=9999")
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(prismaMock.todo.count).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request with a 401", async () => {
    const res = await GET(
      new NextRequest(new Request("http://localhost/api/analytics"))
    );
    expect(res.status).toBe(401);
  });
});
