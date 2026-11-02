import { describe, it, expect } from "vitest";
import { advanceDate, computeNextOccurrence } from "@/lib/recurrence";

describe("advanceDate", () => {
  it("advances daily by the given interval", () => {
    const start = new Date("2024-01-10T09:00:00.000Z");
    expect(advanceDate(start, "DAILY", 1).toISOString()).toBe("2024-01-11T09:00:00.000Z");
    expect(advanceDate(start, "DAILY", 5).toISOString()).toBe("2024-01-15T09:00:00.000Z");
  });

  it("advances weekly in 7-day steps", () => {
    const start = new Date("2024-01-10T09:00:00.000Z");
    expect(advanceDate(start, "WEEKLY", 1).toISOString()).toBe("2024-01-17T09:00:00.000Z");
    expect(advanceDate(start, "WEEKLY", 2).toISOString()).toBe("2024-01-24T09:00:00.000Z");
  });

  it("advances monthly", () => {
    const start = new Date("2024-01-15T09:00:00.000Z");
    expect(advanceDate(start, "MONTHLY", 1).toISOString()).toBe("2024-02-15T09:00:00.000Z");
    expect(advanceDate(start, "MONTHLY", 3).toISOString()).toBe("2024-04-15T09:00:00.000Z");
  });

  it("clamps monthly to the last day of a shorter target month", () => {
    // Jan 31 + 1 month must land on the last day of February, not spill into March.
    const jan31 = new Date(2024, 0, 31, 9, 0, 0);
    const result = advanceDate(jan31, "MONTHLY", 1);
    expect(result.getMonth()).toBe(1); // February
    expect(result.getDate()).toBe(29); // 2024 is a leap year
  });

  it("does not mutate the input date", () => {
    const start = new Date("2024-01-10T09:00:00.000Z");
    const snapshot = start.getTime();
    advanceDate(start, "DAILY", 3);
    expect(start.getTime()).toBe(snapshot);
  });

  it("defaults a non-positive interval to 1", () => {
    const start = new Date("2024-01-10T09:00:00.000Z");
    expect(advanceDate(start, "DAILY", 0).toISOString()).toBe("2024-01-11T09:00:00.000Z");
  });
});

describe("computeNextOccurrence", () => {
  it("advances both startDate and dueDate preserving the gap", () => {
    const next = computeNextOccurrence(
      {
        startDate: new Date("2024-01-10T00:00:00.000Z"),
        dueDate: new Date("2024-01-12T00:00:00.000Z"),
      },
      "WEEKLY",
      1
    );
    expect(next?.startDate?.toISOString()).toBe("2024-01-17T00:00:00.000Z");
    expect(next?.dueDate?.toISOString()).toBe("2024-01-19T00:00:00.000Z");
  });

  it("keeps a null date null", () => {
    const next = computeNextOccurrence(
      { startDate: null, dueDate: new Date("2024-01-12T00:00:00.000Z") },
      "DAILY",
      2
    );
    expect(next?.startDate).toBeNull();
    expect(next?.dueDate?.toISOString()).toBe("2024-01-14T00:00:00.000Z");
  });

  it("returns null when neither date is set", () => {
    expect(computeNextOccurrence({ startDate: null, dueDate: null }, "DAILY", 1)).toBeNull();
  });
});
