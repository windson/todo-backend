import type { PrismaClient } from "@prisma/client";
import { parseCsv } from "./csv";
import {
  ImportBundleSchema,
  type ImportBundleInput,
  type ImportTodoInput,
} from "./validation";

/**
 * Import model (FEAT-009):
 * All imported rows are created for the CURRENT user only. The payload NEVER
 * carries or influences a userId - records are written with the authenticated
 * user's id, so an import can never write into another user's data.
 *
 * Conflict handling: category and tag names are per-user unique
 * (@@unique([userId, name])). On import an existing category/tag with the same
 * name is REUSED (not duplicated, not errored); a missing one is created. Todos
 * are always created (no de-duplication) since todos have no natural key.
 *
 * The summary counts what was created, what was skipped (rows that failed
 * per-row validation), and collects human-readable errors per skipped row.
 */

export interface ImportSummary {
  created: {
    categories: number;
    tags: number;
    todos: number;
  };
  skipped: {
    categories: number;
    tags: number;
    todos: number;
  };
  reused: {
    categories: number;
    tags: number;
  };
  errors: string[];
}

const DEFAULT_COLOR = "#6366f1";

/**
 * Convert a parsed CSV (flat todos, as produced by the export route) into the
 * bundle shape the importer consumes. Only todos come from CSV; categories/tags
 * are derived on demand from the todo rows (by name). Unknown columns are
 * ignored. The caller still runs Zod validation on the result.
 */
export function csvToBundle(csv: string): ImportBundleInput {
  const records = parseCsv(csv);
  const todos: ImportBundleInput["todos"] = records.map((row) => {
    const todo: Record<string, unknown> = {
      title: row.title ?? "",
    };
    if (row.description !== undefined && row.description !== "") {
      todo.description = row.description;
    }
    if (row.completed !== undefined && row.completed !== "") {
      todo.completed = row.completed.toLowerCase() === "true";
    }
    if (row.priority) todo.priority = row.priority.toUpperCase();
    if (row.startDate) todo.startDate = row.startDate;
    if (row.dueDate) todo.dueDate = row.dueDate;
    if (row.category) todo.category = row.category;
    if (row.tags) {
      const tags = row.tags
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      if (tags.length > 0) todo.tags = tags;
    }
    return todo as ImportBundleInput["todos"] extends (infer U)[] | undefined
      ? U
      : never;
  });
  return { todos };
}

type ImportWriter = Pick<PrismaClient, "category" | "tag" | "todo">;

/**
 * Create records for `userId` from a validated import bundle. Categories and
 * tags are resolved by name (reused if they already exist for the user, created
 * otherwise); todos are created and linked to those categories/tags. Returns a
 * summary of created/reused/skipped counts and any per-row errors.
 */
export async function importBundle(
  client: ImportWriter,
  userId: string,
  bundle: ImportBundleInput
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    created: { categories: 0, tags: 0, todos: 0 },
    skipped: { categories: 0, tags: 0, todos: 0 },
    reused: { categories: 0, tags: 0 },
    errors: [],
  };

  // Resolve (reuse-or-create) a category by name, caching results so repeated
  // names across todos cost at most one lookup/insert.
  const categoryCache = new Map<string, string>();
  async function resolveCategory(
    name: string,
    color?: string
  ): Promise<string> {
    const cached = categoryCache.get(name);
    if (cached) return cached;
    const existing = await client.category.findFirst({
      where: { userId, name },
      select: { id: true },
    });
    if (existing) {
      summary.reused.categories += 1;
      categoryCache.set(name, existing.id);
      return existing.id;
    }
    const created = await client.category.create({
      data: { userId, name, color: color ?? DEFAULT_COLOR },
      select: { id: true },
    });
    summary.created.categories += 1;
    categoryCache.set(name, created.id);
    return created.id;
  }

  const tagCache = new Map<string, string>();
  async function resolveTag(name: string, color?: string): Promise<string> {
    const cached = tagCache.get(name);
    if (cached) return cached;
    const existing = await client.tag.findFirst({
      where: { userId, name },
      select: { id: true },
    });
    if (existing) {
      summary.reused.tags += 1;
      tagCache.set(name, existing.id);
      return existing.id;
    }
    const created = await client.tag.create({
      data: { userId, name, color: color ?? DEFAULT_COLOR },
      select: { id: true },
    });
    summary.created.tags += 1;
    tagCache.set(name, created.id);
    return created.id;
  }

  // Seed caches with any explicitly-listed categories/tags first so their
  // colors are honored even if a todo references them before they are listed.
  for (const category of bundle.categories ?? []) {
    try {
      await resolveCategory(category.name, category.color);
    } catch {
      summary.skipped.categories += 1;
      summary.errors.push(`Failed to import category "${category.name}"`);
    }
  }
  for (const tag of bundle.tags ?? []) {
    try {
      await resolveTag(tag.name, tag.color);
    } catch {
      summary.skipped.tags += 1;
      summary.errors.push(`Failed to import tag "${tag.name}"`);
    }
  }

  const todos = bundle.todos ?? [];
  for (let i = 0; i < todos.length; i++) {
    const todo: ImportTodoInput = todos[i];
    try {
      const categoryId = todo.category
        ? await resolveCategory(todo.category)
        : undefined;

      const tagIds: string[] = [];
      for (const tagName of todo.tags ?? []) {
        tagIds.push(await resolveTag(tagName));
      }

      await client.todo.create({
        data: {
          userId,
          title: todo.title,
          description: todo.description ?? undefined,
          completed: todo.completed ?? false,
          priority: todo.priority ?? undefined,
          startDate: todo.startDate ?? undefined,
          dueDate: todo.dueDate ?? undefined,
          categoryId,
          tags: tagIds.length
            ? { create: tagIds.map((tagId) => ({ tagId })) }
            : undefined,
        },
      });
      summary.created.todos += 1;
    } catch {
      summary.skipped.todos += 1;
      summary.errors.push(
        `Failed to import todo "${todo.title}" (row ${i + 1})`
      );
    }
  }

  return summary;
}

/**
 * Parse + validate raw import input. `content` is either a JSON bundle string
 * or CSV text; `format` selects the reader. Returns the validated bundle or a
 * list of validation error messages (never both). This keeps the route handler
 * thin and lets tests exercise validation directly.
 */
export function parseImportInput(
  content: string,
  format: "json" | "csv"
): { bundle: ImportBundleInput } | { errors: string[] } {
  let raw: unknown;
  if (format === "csv") {
    raw = csvToBundle(content);
  } else {
    try {
      raw = JSON.parse(content);
    } catch {
      return { errors: ["Invalid JSON payload"] };
    }
  }

  const parsed = ImportBundleSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`
      ),
    };
  }
  return { bundle: parsed.data };
}
