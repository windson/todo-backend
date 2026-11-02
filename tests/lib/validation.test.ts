import { describe, it, expect } from "vitest";
import {
  CreateTodoSchema,
  CreateCategorySchema,
  BulkOperationSchema,
  TodoQueryParamsSchema,
} from "@/lib/validation";

describe("CreateTodoSchema", () => {
  it("accepts a valid todo payload", () => {
    const result = CreateTodoSchema.safeParse({
      title: "Write tests",
      description: "Cover the validation layer",
      priority: "HIGH",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty title", () => {
    const result = CreateTodoSchema.safeParse({ title: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Title is required");
    }
  });

  it("rejects a title longer than 255 characters", () => {
    const result = CreateTodoSchema.safeParse({ title: "a".repeat(256) });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid priority value", () => {
    const result = CreateTodoSchema.safeParse({
      title: "Valid",
      priority: "SOMEDAY",
    });
    expect(result.success).toBe(false);
  });
});

describe("CreateCategorySchema", () => {
  it("accepts a valid 6-digit hex color", () => {
    const result = CreateCategorySchema.safeParse({
      name: "Work",
      color: "#ff0000",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed hex color", () => {
    const result = CreateCategorySchema.safeParse({
      name: "Work",
      color: "red",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a 3-digit hex color shorthand", () => {
    const result = CreateCategorySchema.safeParse({
      name: "Work",
      color: "#f00",
    });
    expect(result.success).toBe(false);
  });
});

describe("BulkOperationSchema", () => {
  it("requires at least one id", () => {
    const result = BulkOperationSchema.safeParse({
      operation: "complete",
      ids: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects more than 50 ids", () => {
    const result = BulkOperationSchema.safeParse({
      operation: "delete",
      ids: Array.from({ length: 51 }, (_, i) => `id-${i}`),
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid bulk payload", () => {
    const result = BulkOperationSchema.safeParse({
      operation: "uncomplete",
      ids: ["a", "b"],
    });
    expect(result.success).toBe(true);
  });
});

describe("TodoQueryParamsSchema", () => {
  it("coerces numeric limit/offset from strings", () => {
    const result = TodoQueryParamsSchema.safeParse({
      limit: "10",
      offset: "5",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
      expect(result.data.offset).toBe(5);
    }
  });

  it("rejects a limit above 100", () => {
    const result = TodoQueryParamsSchema.safeParse({ limit: "500" });
    expect(result.success).toBe(false);
  });
});
