import type { Prisma } from "@prisma/client";

/**
 * A Todo as loaded by the route handlers: with its category, join-table tags,
 * and (optionally) its child subtasks each with their own category/tags.
 */
type TodoTagJoin = { tag: unknown };

type RawChildTodo = Record<string, unknown> & {
  completed: boolean;
  tags?: TodoTagJoin[];
};

type RawTodo = Record<string, unknown> & {
  tags?: TodoTagJoin[];
  children?: RawChildTodo[];
};

export interface SubtaskProgress {
  total: number;
  completed: number;
}

/**
 * Flatten the join-table tags on a todo (and its children) into plain Tag
 * objects and attach a computed `progress` summary describing how many of the
 * todo's direct subtasks are completed.
 */
export function formatTodo<T extends RawTodo>(todo: T) {
  const children = (todo.children ?? []).map((child) => ({
    ...child,
    tags: (child.tags ?? []).map((tt) => tt.tag),
  }));

  const progress: SubtaskProgress = {
    total: children.length,
    completed: children.filter((child) => child.completed).length,
  };

  return {
    ...todo,
    tags: (todo.tags ?? []).map((tt) => tt.tag),
    children,
    progress,
  };
}

/**
 * Minimal public user projection used for assignee and share members. Never
 * exposes passwordHash or other sensitive fields.
 */
const publicUserSelect = {
  id: true,
  email: true,
  name: true,
} satisfies Prisma.UserSelect;

/** Shared include clause so list and detail handlers return identical shapes. */
export const todoInclude = {
  category: true,
  tags: { include: { tag: true } },
  assignee: { select: publicUserSelect },
  shares: {
    orderBy: { createdAt: "asc" },
    include: { user: { select: publicUserSelect } },
  },
  children: {
    orderBy: { order: "asc" },
    include: {
      category: true,
      tags: { include: { tag: true } },
      assignee: { select: publicUserSelect },
    },
  },
} satisfies Prisma.TodoInclude;
