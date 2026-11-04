import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// Import the Prisma mock helper first (registers the module mock + reset hook).
import { prismaMock } from "../helpers/prisma-mock";
import { runSeed } from "../../prisma/seed";
import type { PrismaClient } from "@prisma/client";

const DEMO_PW = "demo-seed-secret-1234";
const COLLAB_PW = "collab-seed-secret-5678";
const EXISTING_HASH = "existing-placeholder-hash";

type UserRow = { id: string; email: string; passwordHash: string; name: string };

/** Wire the deep mock into a small in-memory store so reruns are observable. */
function wireStore(initialUsers: UserRow[] = []) {
  const users = new Map<string, UserRow>(initialUsers.map((u) => [u.email, u]));
  const categories = new Map<string, { id: string }>();
  const tags = new Map<string, { id: string }>();
  const todos = new Map<string, { id: string; title: string }>();
  let seq = 0;
  const nextId = (p: string) => `${p}-${++seq}`;

  prismaMock.user.upsert.mockImplementation((async (args: {
    where: { email: string };
    create: { email: string; passwordHash: string; name: string };
  }) => {
    const found = users.get(args.where.email);
    if (found) return found; // update: {} leaves the stored hash untouched
    const row = { id: nextId("user"), ...args.create };
    users.set(row.email, row);
    return row;
  }) as never);
  prismaMock.category.upsert.mockImplementation((async (args: {
    where: { userId_name: { name: string } };
  }) => {
    const key = args.where.userId_name.name;
    if (!categories.has(key)) categories.set(key, { id: nextId("cat") });
    return categories.get(key);
  }) as never);
  prismaMock.tag.upsert.mockImplementation((async (args: {
    where: { userId_name: { name: string } };
  }) => {
    const key = args.where.userId_name.name;
    if (!tags.has(key)) tags.set(key, { id: nextId("tag") });
    return tags.get(key);
  }) as never);
  prismaMock.todo.findFirst.mockImplementation((async (args: {
    where: { title: string; parentId: string | null };
  }) => todos.get(`${args.where.parentId}:${args.where.title}`) ?? null) as never);
  prismaMock.todo.create.mockImplementation((async (args: {
    data: { title: string; parentId?: string | null };
  }) => {
    const row = { id: nextId("todo"), title: args.data.title };
    todos.set(`${args.data.parentId ?? null}:${args.data.title}`, row);
    return row;
  }) as never);
  let seeded = false;
  prismaMock.activityLog.findFirst.mockImplementation((async () =>
    seeded ? { id: "log" } : null) as never);
  prismaMock.$transaction.mockImplementation((async (fn: (tx: unknown) => Promise<void>) => {
    await fn(prismaMock);
    seeded = true;
  }) as never);

  return { users, categories, tags, todos };
}

const client = () => prismaMock as unknown as PrismaClient;

describe("prisma seed", () => {
  const savedEnv = { ...process.env };
  let logSpies: ReturnType<typeof vi.spyOn>[];

  beforeEach(() => {
    process.env.SEED_PASSWORD_DEMO = DEMO_PW;
    process.env.SEED_PASSWORD_COLLABORATOR = COLLAB_PW;
    logSpies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...savedEnv };
  });

  it("is importable without running the seed", () => {
    expect(typeof runSeed).toBe("function");
  });

  it("creates no duplicates when the idempotent seed runs twice", async () => {
    const store = wireStore();
    await runSeed(client(), true);
    const afterFirst = {
      users: store.users.size,
      todos: store.todos.size,
      txCalls: prismaMock.$transaction.mock.calls.length,
      todoCreates: prismaMock.todo.create.mock.calls.length,
    };
    expect(afterFirst.users).toBe(2);
    expect(afterFirst.txCalls).toBe(1);

    await runSeed(client(), true);
    expect(store.users.size).toBe(2);
    expect(store.todos.size).toBe(afterFirst.todos);
    // Second run creates no new todos and does not re-run the child transaction.
    expect(prismaMock.todo.create.mock.calls.length).toBe(afterFirst.todoCreates);
    expect(prismaMock.$transaction.mock.calls.length).toBe(1);
    // Idempotent mode never deletes.
    expect(prismaMock.user.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.todo.deleteMany).not.toHaveBeenCalled();
  });

  it("does not overwrite an existing user's password hash", async () => {
    const store = wireStore([
      { id: "u-existing", email: "demo@example.com", passwordHash: EXISTING_HASH, name: "Demo User" },
    ]);
    await runSeed(client(), true);
    await runSeed(client(), true);
    expect(store.users.get("demo@example.com")?.passwordHash).toBe(EXISTING_HASH);
    for (const call of prismaMock.user.upsert.mock.calls) {
      expect(call[0].update).toEqual({});
    }
  });

  it("writes child data inside a single transaction", async () => {
    wireStore();
    await runSeed(client(), true);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.comment.createMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.todoShare.create).toHaveBeenCalledTimes(1);
  });

  it("requires env passwords of at least 12 characters in idempotent mode", async () => {
    wireStore();
    process.env.SEED_PASSWORD_DEMO = "short";
    await expect(runSeed(client(), true)).rejects.toThrow(/SEED_PASSWORD_DEMO/);
  });

  it("refuses the destructive path when NODE_ENV=production", async () => {
    wireStore();
    (process.env as Record<string, string>).NODE_ENV = "production";
    await expect(runSeed(client(), false)).rejects.toThrow(/Refusing to wipe data in production/);
    expect(prismaMock.user.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.todo.deleteMany).not.toHaveBeenCalled();
  });

  it("never writes a password or hash to console output", async () => {
    const store = wireStore();
    await runSeed(client(), true);
    const hashes = [...store.users.values()].map((u) => u.passwordHash);
    const output = logSpies
      .flatMap((s) => s.mock.calls)
      .map((args) => args.map(String).join(" "))
      .join("\n");
    expect(output.length).toBeGreaterThan(0);
    for (const secret of [DEMO_PW, COLLAB_PW, "password123", ...hashes]) {
      expect(output).not.toContain(secret);
    }
  });
});
