import { PrismaClient, Priority } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PoolConfig } from "pg";
import bcrypt from "bcryptjs";

// Seed modes:
//  - default (local dev): wipes all tables and recreates data with the
//    well-known dev password. Refused when NODE_ENV=production.
//  - SEED_MODE=idempotent (deployed environments): NEVER deletes anything.
//    Everything is upserted / created only when missing, so re-running creates
//    no duplicates. Passwords come from SEED_PASSWORD_DEMO and
//    SEED_PASSWORD_COLLABORATOR (required, never logged).
const idempotent = process.env.SEED_MODE === "idempotent";

function poolConfig(): PoolConfig {
  if (process.env.DB_HOST) {
    return {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT ?? 5432),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ...(process.env.DB_SSL === "require"
        ? { ssl: { rejectUnauthorized: false } }
        : {}),
    };
  }
  return { connectionString: process.env.DATABASE_URL! };
}

const prisma = new PrismaClient({ adapter: new PrismaPg(poolConfig()) });

function passwordFor(envName: string): string {
  if (!idempotent) return "password123";
  const value = process.env[envName];
  if (!value || value.length < 12) {
    throw new Error(`${envName} must be set (min 12 chars) when SEED_MODE=idempotent`);
  }
  return value;
}

async function main() {
  console.log(`Seeding database (${idempotent ? "idempotent" : "reset"} mode)...`);

  if (!idempotent) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Refusing to wipe data in production; use SEED_MODE=idempotent");
    }
    // Clean existing data. Most child tables cascade from Todo/User, but clear
    // the join/share tables explicitly for a deterministic reset.
    await prisma.todoShare.deleteMany();
    await prisma.todoTag.deleteMany();
    await prisma.todo.deleteMany();
    await prisma.tag.deleteMany();
    await prisma.category.deleteMany();
    await prisma.user.deleteMany();
  }

  const upsertUser = async (email: string, name: string, envName: string) => {
    const passwordHash = await bcrypt.hash(passwordFor(envName), 10);
    return prisma.user.upsert({
      where: { email },
      // Never overwrite an existing user's password hash: re-running the seed
      // must not clobber passwords changed by real users.
      update: {},
      create: { email, passwordHash, name },
    });
  };

  const user = await upsertUser("demo@example.com", "Demo User", "SEED_PASSWORD_DEMO");
  console.log(`Ready demo user ${user.email}`);

  const collaborator = await upsertUser(
    "collaborator@example.com",
    "Casey Collaborator",
    "SEED_PASSWORD_COLLABORATOR",
  );
  console.log(`Ready collaborator user ${collaborator.email}`);

  const upsertCategory = (name: string, color: string) =>
    prisma.category.upsert({
      where: { userId_name: { userId: user.id, name } },
      update: { color },
      create: { name, color, userId: user.id },
    });
  const upsertTag = (name: string, color: string) =>
    prisma.tag.upsert({
      where: { userId_name: { userId: user.id, name } },
      update: { color },
      create: { name, color, userId: user.id },
    });

  // Create categories
  const categories = [
    await upsertCategory("Work", "#3B82F6"),
    await upsertCategory("Personal", "#10B981"),
    await upsertCategory("Shopping", "#F59E0B"),
    await upsertCategory("Health", "#EF4444"),
  ];

  console.log(`Created ${categories.length} categories`);

  // Create tags
  const tags = [
    await upsertTag("important", "#DC2626"),
    await upsertTag("quick-win", "#16A34A"),
    await upsertTag("blocked", "#9333EA"),
    await upsertTag("review", "#2563EB"),
  ];

  console.log(`Created ${tags.length} tags`);

  // Create todos with varied data
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const nextMonth = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const todosData = [
    {
      title: "Complete project proposal",
      description: "Write and submit the Q4 project proposal document",
      priority: Priority.HIGH,
      dueDate: tomorrow,
      categoryId: categories[0].id,
      order: 1,
      tagIds: [tags[0].id, tags[3].id],
    },
    {
      title: "Review pull requests",
      description: "Review the pending PRs from the team",
      priority: Priority.MEDIUM,
      dueDate: tomorrow,
      categoryId: categories[0].id,
      order: 2,
      tagIds: [tags[3].id],
    },
    {
      title: "Buy groceries",
      description: "Milk, eggs, bread, vegetables, and fruit",
      priority: Priority.LOW,
      dueDate: nextWeek,
      categoryId: categories[2].id,
      order: 3,
      tagIds: [tags[1].id],
    },
    {
      title: "Schedule dentist appointment",
      description: "Annual checkup is overdue",
      priority: Priority.MEDIUM,
      dueDate: nextMonth,
      categoryId: categories[3].id,
      order: 4,
      tagIds: [],
    },
    {
      title: "Fix authentication bug",
      description: "Users are getting logged out unexpectedly on mobile",
      priority: Priority.URGENT,
      dueDate: yesterday,
      categoryId: categories[0].id,
      completed: true,
      order: 5,
      tagIds: [tags[0].id],
    },
    {
      title: "Plan weekend trip",
      description: "Research destinations and book accommodation",
      priority: Priority.LOW,
      dueDate: nextWeek,
      categoryId: categories[1].id,
      order: 6,
      tagIds: [tags[1].id],
    },
    {
      title: "Update resume",
      description: "Add recent projects and skills",
      priority: Priority.MEDIUM,
      categoryId: categories[1].id,
      order: 7,
      tagIds: [],
    },
    {
      title: "Setup CI/CD pipeline",
      description: "Configure GitHub Actions for automated testing and deployment",
      priority: Priority.HIGH,
      dueDate: nextWeek,
      categoryId: categories[0].id,
      order: 8,
      tagIds: [tags[2].id, tags[0].id],
    },
    {
      title: "Morning jog routine",
      description: "Start 30 minutes daily morning jog",
      priority: Priority.MEDIUM,
      categoryId: categories[3].id,
      completed: true,
      order: 9,
      tagIds: [tags[1].id],
    },
    {
      title: "Read Clean Code book",
      description: "Finish reading the remaining chapters",
      priority: Priority.LOW,
      dueDate: nextMonth,
      categoryId: categories[1].id,
      order: 10,
      tagIds: [],
    },
    {
      title: "Deploy staging environment",
      description: "Set up the staging server with latest changes",
      priority: Priority.HIGH,
      dueDate: tomorrow,
      categoryId: categories[0].id,
      order: 11,
      tagIds: [tags[2].id, tags[3].id],
    },
    {
      title: "Order new running shoes",
      description: "Size 10, neutral cushioning",
      priority: Priority.LOW,
      categoryId: categories[2].id,
      completed: true,
      order: 12,
      tagIds: [tags[1].id],
    },
  ];

  // Create a todo only if the user has no top-level/sibling todo with the same
  // title yet, so re-running in idempotent mode adds no duplicates.
  const todoExists = async (title: string, parentId: string | null = null) =>
    (await prisma.todo.findFirst({
      where: { userId: user.id, title, parentId },
      select: { id: true },
    })) !== null;

  for (const todoData of todosData) {
    const { tagIds, ...data } = todoData;
    if (await todoExists(data.title)) continue;
    await prisma.todo.create({
      data: {
        ...data,
        userId: user.id,
        tags: tagIds.length > 0
          ? { create: tagIds.map((tagId) => ({ tagId })) }
          : undefined,
      },
    });
  }

  console.log(`Created ${todosData.length} todos`);

  // Create a parent todo with a small checklist of subtasks to exercise the
  // subtasks / progress feature.
  const existingParent = await prisma.todo.findFirst({
    where: { userId: user.id, title: "Launch marketing website", parentId: null },
  });
  const parentTodo = existingParent ?? (await prisma.todo.create({
    data: {
      title: "Launch marketing website",
      description: "Coordinate the full launch checklist",
      priority: Priority.HIGH,
      dueDate: nextWeek,
      categoryId: categories[0].id,
      order: 13,
      userId: user.id,
    },
  }));

  const subtasks = [
    { title: "Write landing page copy", completed: true, order: 1 },
    { title: "Design hero section", completed: true, order: 2 },
    { title: "Set up analytics", completed: false, order: 3 },
    { title: "Configure custom domain", completed: false, order: 4 },
  ];

  for (const subtask of subtasks) {
    if (await todoExists(subtask.title, parentTodo.id)) continue;
    await prisma.todo.create({
      data: {
        ...subtask,
        priority: Priority.MEDIUM,
        userId: user.id,
        parentId: parentTodo.id,
      },
    });
  }

  console.log(`Created 1 parent todo with ${subtasks.length} subtasks`);

  // Everything attached to the parent todo is created in ONE transaction, and
  // is considered done only once its final activity entry ("todo.assigned")
  // exists. A run that fails midway rolls back, so the next run retries it
  // instead of leaving the parent permanently without its child data.
  const alreadySeeded =
    (await prisma.activityLog.findFirst({
      where: { todoId: parentTodo.id, action: "todo.assigned" },
      select: { id: true },
    })) !== null;
  if (!alreadySeeded) {
    await prisma.$transaction(async (tx) => {
      // Add a couple of comments, an attachment reference, and some activity-log
      // entries to the parent todo to exercise the rich-content feature.
      await tx.comment.createMany({
        data: [
          {
            todoId: parentTodo.id,
            userId: user.id,
            body: "Kicking this off. See the **brief** in the attached doc.",
          },
          {
            todoId: parentTodo.id,
            userId: user.id,
            body: "Copy is drafted, moving on to analytics next.",
          },
        ],
      });

      await tx.attachment.create({
        data: {
          todoId: parentTodo.id,
          filename: "launch-brief.pdf",
          url: "https://example.com/files/launch-brief.pdf",
          mimeType: "application/pdf",
          size: 248_000,
        },
      });

      await tx.activityLog.createMany({
        data: [
          {
            todoId: parentTodo.id,
            userId: user.id,
            action: "todo.created",
            metadata: { title: parentTodo.title },
          },
          {
            todoId: parentTodo.id,
            userId: user.id,
            action: "comment.created",
          },
          {
            todoId: parentTodo.id,
            userId: user.id,
            action: "attachment.added",
            metadata: { filename: "launch-brief.pdf" },
          },
        ],
      });

      console.log("Created comments, an attachment, and activity for the parent todo");

      // Create a recurring todo to exercise the recurrence feature. Completing it
      // via the API will spawn the next weekly occurrence.
      if (!(await todoExists("Weekly team sync"))) await tx.todo.create({
        data: {
          title: "Weekly team sync",
          description: "Recurring weekly standup with the team",
          priority: Priority.MEDIUM,
          startDate: now,
          dueDate: tomorrow,
          recurrenceRule: "WEEKLY",
          recurrenceInterval: 1,
          categoryId: categories[0].id,
          order: 14,
          userId: user.id,
        },
      });

      console.log("Created 1 recurring todo");

      // Add an in-app reminder on the parent todo and an unread notification so the
      // reminders/notifications feature has seed data to surface.
      const reminderAt = new Date(now.getTime() + 60 * 60 * 1000); // one hour out
      await tx.reminder.create({
        data: {
          todoId: parentTodo.id,
          userId: user.id,
          remindAt: reminderAt,
          channel: "INAPP",
        },
      });

      await tx.notification.create({
        data: {
          userId: user.id,
          type: "reminder.due",
          read: false,
          payload: {
            todoId: parentTodo.id,
            todoTitle: parentTodo.title,
            channel: "INAPP",
          },
        },
      });

      console.log("Created 1 reminder and 1 unread notification");

      // Add a couple of saved views (named smart filters) so the saved-views /
      // board feature has seed data. `filters` mirrors the GET /api/todos query
      // params the frontend round-trips through its TodoFilters.
      await tx.savedView.create({
        data: {
          userId: user.id,
          name: "High priority",
          filters: { priority: "HIGH,URGENT", completed: "false", sortBy: "dueDate", sortOrder: "asc" },
        },
      });

      await tx.savedView.create({
        data: {
          userId: user.id,
          name: "Due today",
          filters: { dueFilter: "today", completed: "false" },
        },
      });

      console.log("Created 2 saved views");

      // Sharing & collaboration (FEAT-008): share the parent "Launch marketing
      // website" todo with the collaborator as an EDITOR and assign it to them.
      await tx.todoShare.create({
        data: {
          todoId: parentTodo.id,
          userId: collaborator.id,
          role: "EDITOR",
        },
      });

      await tx.todo.update({
        where: { id: parentTodo.id },
        data: { assigneeId: collaborator.id },
      });

      await tx.activityLog.createMany({
        data: [
          {
            todoId: parentTodo.id,
            userId: user.id,
            action: "todo.shared",
            metadata: { sharedWithUserId: collaborator.id, role: "EDITOR" },
          },
          {
            todoId: parentTodo.id,
            userId: user.id,
            action: "todo.assigned",
            metadata: { assigneeId: collaborator.id },
          },
        ],
      });

      // Notify the collaborator that a todo was shared with and assigned to them.
      await tx.notification.createMany({
        data: [
          {
            userId: collaborator.id,
            type: "todo.shared",
            read: false,
            payload: { todoId: parentTodo.id, todoTitle: parentTodo.title, role: "EDITOR" },
          },
          {
            userId: collaborator.id,
            type: "todo.assigned",
            read: false,
            payload: { todoId: parentTodo.id, todoTitle: parentTodo.title },
          },
        ],
      });

      console.log("Shared and assigned the launch todo to the collaborator");
    }, { timeout: 30_000 });
  }
  console.log("Seeding completed!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
