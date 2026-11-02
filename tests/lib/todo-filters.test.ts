import { describe, it, expect } from "vitest";
import { buildDueDateFilter, startOfDay, endOfDay } from "@/lib/todo-filters";

describe("buildDueDateFilter", () => {
  const now = new Date(2024, 5, 15, 13, 30, 0); // 2024-06-15 13:30 local

  it("builds a today range spanning the full day", () => {
    const filter = buildDueDateFilter("today", now);
    expect(filter.gte?.getTime()).toBe(startOfDay(now).getTime());
    expect(filter.lte?.getTime()).toBe(endOfDay(now).getTime());
  });

  it("builds an upcoming range starting tomorrow", () => {
    const filter = buildDueDateFilter("upcoming", now);
    const tomorrowStart = startOfDay(now);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    expect(filter.gte?.getTime()).toBe(tomorrowStart.getTime());
    expect(filter.lte).toBeUndefined();
  });

  it("builds an overdue range before the start of today", () => {
    const filter = buildDueDateFilter("overdue", now);
    expect(filter.lt?.getTime()).toBe(startOfDay(now).getTime());
    expect(filter.gte).toBeUndefined();
  });
});
