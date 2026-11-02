import type { PrismaClient } from "@prisma/client";
import { toCsv } from "./csv";

/**
 * Export scope decision (FEAT-009):
 * Export covers ONLY todos (and the categories/tags) the user OWNS
 * (where: { userId }). Shared-with-me todos belong to another owner and are
 * excluded so a backup round-trips cleanly into the same account without
 * duplicating another user's data. This matches the analytics owned-only scope.
 */

type ExportReader = Pick<PrismaClient, "category" | "tag" | "todo">;

export interface ExportedCategory {
  name: string;
  color: string;
}

export interface ExportedTag {
  name: string;
  color: string;
}

export interface ExportedTodo {
  title: string;
  description: string | null;
  completed: boolean;
  priority: string;
  startDate: string | null;
  dueDate: string | null;
  category: string | null;
  tags: string[];
}

export interface ExportBundle {
  exportedAt: string;
  version: 1;
  categories: ExportedCategory[];
  tags: ExportedTag[];
  todos: ExportedTodo[];
}

/**
 * Build the user's full export bundle (categories, tags, and OWNED todos with
 * their category/tag names). Names are used instead of ids so the bundle is
 * portable across accounts on import.
 */
export async function buildExportBundle(
  client: ExportReader,
  userId: string
): Promise<ExportBundle> {
  const [categories, tags, todos] = await Promise.all([
    client.category.findMany({
      where: { userId },
      select: { name: true, color: true },
      orderBy: { name: "asc" },
    }),
    client.tag.findMany({
      where: { userId },
      select: { name: true, color: true },
      orderBy: { name: "asc" },
    }),
    client.todo.findMany({
      where: { userId },
      select: {
        title: true,
        description: true,
        completed: true,
        priority: true,
        startDate: true,
        dueDate: true,
        category: { select: { name: true } },
        tags: { select: { tag: { select: { name: true } } } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const exportedTodos: ExportedTodo[] = (
    todos as Array<{
      title: string;
      description: string | null;
      completed: boolean;
      priority: string;
      startDate: Date | null;
      dueDate: Date | null;
      category: { name: string } | null;
      tags: Array<{ tag: { name: string } }>;
    }>
  ).map((todo) => ({
    title: todo.title,
    description: todo.description,
    completed: todo.completed,
    priority: todo.priority,
    startDate: todo.startDate ? todo.startDate.toISOString() : null,
    dueDate: todo.dueDate ? todo.dueDate.toISOString() : null,
    category: todo.category?.name ?? null,
    tags: todo.tags.map((t) => t.tag.name),
  }));

  return {
    exportedAt: new Date().toISOString(),
    version: 1,
    categories: categories as ExportedCategory[],
    tags: tags as ExportedTag[],
    todos: exportedTodos,
  };
}

/** CSV column order for the flat todos export. */
export const TODO_CSV_COLUMNS = [
  "title",
  "description",
  "completed",
  "priority",
  "startDate",
  "dueDate",
  "category",
  "tags",
] as const;

/**
 * Render the bundle's todos as a flat CSV. The `tags` column is a
 * comma-joined, space-separated list inside one quoted field; `category` is the
 * category name. This is the shape the import route's CSV reader expects.
 */
export function bundleToCsv(bundle: ExportBundle): string {
  const rows = bundle.todos.map((todo) => ({
    title: todo.title,
    description: todo.description ?? "",
    completed: todo.completed ? "true" : "false",
    priority: todo.priority,
    startDate: todo.startDate ?? "",
    dueDate: todo.dueDate ?? "",
    category: todo.category ?? "",
    tags: todo.tags.join(", "),
  }));
  return toCsv(TODO_CSV_COLUMNS, rows);
}
