import type { Prisma, PrismaClient, ShareRole } from "@prisma/client";
import { ApiError } from "./errors";

/** A Prisma client (or transaction client) that can read todos and shares. */
type TodoReader = Pick<PrismaClient, "todo">;

/**
 * The access level a user has on a todo.
 * - "owner"  : the todo belongs to the user (Todo.userId). Full control:
 *              read, write, share/unshare, assign, delete.
 * - "editor" : the todo was shared with the user at role EDITOR. May read and
 *              write the todo and its sub-resources, but may NOT share/unshare,
 *              reassign ownership, or delete the todo.
 * - "viewer" : the todo was shared with the user at role VIEWER. Read-only.
 * - null     : the user has no relationship to the todo.
 */
export type TodoAccessLevel = "owner" | "editor" | "viewer" | null;

export interface TodoAccess {
  todoId: string;
  /** The owner of the todo (Todo.userId). */
  ownerId: string;
  level: Exclude<TodoAccessLevel, null>;
}

/** Whether an access level is permitted to read the todo and its sub-resources. */
export function canRead(level: TodoAccessLevel): boolean {
  return level === "owner" || level === "editor" || level === "viewer";
}

/**
 * Whether an access level is permitted to WRITE (edit the todo or
 * create/edit/delete its sub-resources). Viewers are read-only.
 */
export function canWrite(level: TodoAccessLevel): boolean {
  return level === "owner" || level === "editor";
}

/** Whether an access level may share/unshare, assign, or delete the todo. */
export function canManage(level: TodoAccessLevel): boolean {
  return level === "owner";
}

/**
 * Resolve the current user's access level to a todo, considering ownership
 * first and then an explicit share. Returns null when the todo does not exist
 * OR the user has no relationship to it (callers turn null into a 404 to avoid
 * leaking the existence of other users' todos).
 *
 * This is the single authorization resolver used by every todo route and
 * sub-resource route so the owner-OR-shared rule stays consistent.
 */
export async function resolveTodoAccess(
  client: TodoReader,
  todoId: string,
  userId: string
): Promise<TodoAccess | null> {
  const todo = await client.todo.findUnique({
    where: { id: todoId },
    select: {
      id: true,
      userId: true,
      shares: {
        where: { userId },
        select: { role: true },
      },
    },
  });

  if (!todo) return null;

  if (todo.userId === userId) {
    return { todoId, ownerId: todo.userId, level: "owner" };
  }

  const share = (todo.shares ?? [])[0];
  if (share) {
    return {
      todoId,
      ownerId: todo.userId,
      level: share.role === "EDITOR" ? "editor" : "viewer",
    };
  }

  return null;
}

/**
 * Require that the current user may READ a todo. Throws ApiError.notFound when
 * the user has no relationship to the todo (hiding its existence). Returns the
 * resolved access so callers can branch on the level.
 */
export async function requireTodoRead(
  client: TodoReader,
  todoId: string,
  userId: string
): Promise<TodoAccess> {
  const access = await resolveTodoAccess(client, todoId, userId);
  if (!access || !canRead(access.level)) {
    throw ApiError.notFound("Todo not found");
  }
  return access;
}

/**
 * Require that the current user may WRITE a todo (owner or editor). A user with
 * no relationship gets a 404 (existence hidden); a viewer who CAN see the todo
 * gets a 403 (they know it exists but may not modify it).
 */
export async function requireTodoWrite(
  client: TodoReader,
  todoId: string,
  userId: string
): Promise<TodoAccess> {
  const access = await resolveTodoAccess(client, todoId, userId);
  if (!access || !canRead(access.level)) {
    throw ApiError.notFound("Todo not found");
  }
  if (!canWrite(access.level)) {
    throw ApiError.forbidden("You do not have permission to modify this todo");
  }
  return access;
}

/**
 * Require that the current user may MANAGE a todo (owner only): share/unshare,
 * assign, or delete. Non-related users get a 404; shared users (viewer/editor)
 * get a 403.
 */
export async function requireTodoManage(
  client: TodoReader,
  todoId: string,
  userId: string
): Promise<TodoAccess> {
  const access = await resolveTodoAccess(client, todoId, userId);
  if (!access || !canRead(access.level)) {
    throw ApiError.notFound("Todo not found");
  }
  if (!canManage(access.level)) {
    throw ApiError.forbidden("Only the owner can perform this action");
  }
  return access;
}

/**
 * A Prisma `where` fragment matching todos the user may see in a list: ones
 * they own OR ones explicitly shared with them. Keeps list queries scoped so a
 * user never sees todos they have no relationship to.
 */
export function accessibleTodoWhere(userId: string): Prisma.TodoWhereInput {
  return {
    OR: [{ userId }, { shares: { some: { userId } } }],
  };
}

/** Map the Prisma ShareRole enum to the lowercase access level naming. */
export function roleToLevel(role: ShareRole): "editor" | "viewer" {
  return role === "EDITOR" ? "editor" : "viewer";
}

/** A Prisma client that can read shares (to validate assignees). */
type ShareReader = Pick<PrismaClient, "todoShare">;

/**
 * Whether a candidate assignee may be assigned to a todo. An assignee must be
 * the todo's owner OR a user the todo is already shared with. `ownerId` is the
 * todo's owner; `sharedUserIds` may be pre-loaded by the caller to avoid an
 * extra query.
 */
export function isAssignableUser(
  candidateId: string,
  ownerId: string,
  sharedUserIds: string[]
): boolean {
  return candidateId === ownerId || sharedUserIds.includes(candidateId);
}

/**
 * Validate that `assigneeId` may be assigned to the todo owned by `ownerId`:
 * it must be the owner or a shared user. Returns true/false; the caller decides
 * the error. Reads the todo's shares when needed.
 */
export async function isAssigneeAllowed(
  client: ShareReader,
  todoId: string,
  ownerId: string,
  assigneeId: string
): Promise<boolean> {
  if (assigneeId === ownerId) return true;
  const share = await client.todoShare.findUnique({
    where: { todoId_userId: { todoId, userId: assigneeId } },
    select: { id: true },
  });
  return Boolean(share);
}
