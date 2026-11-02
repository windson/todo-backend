import { PrismaClient, Priority } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding database...");

  // Clean existing data. Most child tables cascade from Todo/User, but clear
  // the join/share tables explicitly for a deterministic reset.
  await prisma.todoShare.deleteMany();
  await prisma.todoTag.deleteMany();
  await prisma.todo.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();

  // Create a demo user that owns all seeded data
  const passwordHash = await bcrypt.hash("password123", 10);
  const user = await prisma.user.create({
    data: {
      email: "demo@example.com",
      passwordHash,
      name: "Demo User",
    },
  });

  console.log(`Created demo user ${user.email}`);

  // Create a second collaborator user so the sharing & assignee feature has
  // seed data. Credentials: collaborator@example.com / password123.
  const collaborator = await prisma.user.create({
    data: {
      email: "collaborator@example.com",
      passwordHash,
      name: "Casey Collaborator",
    },
  });

  console.log(`Created collaborator user ${collaborator.email}`);

  // Create categories
  const categories = await Promise.all([
    prisma.category.create({
      data: { name: "Work", color: "#3B82F6", userId: user.id },
    }),
    prisma.category.create({
      data: { name: "Personal", color: "#10B981", userId: user.id },
    }),
    prisma.category.create({
      data: { name: "Shopping", color: "#F59E0B", userId: user.id },
    }),
    prisma.category.create({
      data: { name: "Health", color: "#EF4444", userId: user.id },
    }),
  ]);

  console.log(`Created ${categories.length} categories`);

  // Create tags
  const tags = await Promise.all([
    prisma.tag.create({
      data: { name: "important", color: "#DC2626", userId: user.id },
    }),
    prisma.tag.create({
      data: { name: "quick-win", color: "#16A34A", userId: user.id },
    }),
    prisma.tag.create({
      data: { name: "blocked", color: "#9333EA", userId: user.id },
    }),
    prisma.tag.create({
      data: { name: "review", color: "#2563EB", userId: user.id },
    }),
  ]);

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

  for (const todoData of todosData) {
    const { tagIds, ...data } = todoData;
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
  const parentTodo = await prisma.todo.create({
    data: {
      title: "Launch marketing website",
      description: "Coordinate the full launch checklist",
      priority: Priority.HIGH,
      dueDate: nextWeek,
      categoryId: categories[0].id,
      order: 13,
      userId: user.id,
    },
  });

  const subtasks = [
    { title: "Write landing page copy", completed: true, order: 1 },
    { title: "Design hero section", completed: true, order: 2 },
    { title: "Set up analytics", completed: false, order: 3 },
    { title: "Configure custom domain", completed: false, order: 4 },
  ];

  for (const subtask of subtasks) {
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

  // Add a couple of comments, an attachment reference, and some activity-log
  // entries to the parent todo to exercise the rich-content feature.
  await prisma.comment.createMany({
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

  await prisma.attachment.create({
    data: {
      todoId: parentTodo.id,
      filename: "launch-brief.pdf",
      url: "https://example.com/files/launch-brief.pdf",
      mimeType: "application/pdf",
      size: 248_000,
    },
  });

  await prisma.activityLog.createMany({
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
  await prisma.todo.create({
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
  await prisma.reminder.create({
    data: {
      todoId: parentTodo.id,
      userId: user.id,
      remindAt: reminderAt,
      channel: "INAPP",
    },
  });

  await prisma.notification.create({
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
  await prisma.savedView.create({
    data: {
      userId: user.id,
      name: "High priority",
      filters: { priority: "HIGH,URGENT", completed: "false", sortBy: "dueDate", sortOrder: "asc" },
    },
  });

  await prisma.savedView.create({
    data: {
      userId: user.id,
      name: "Due today",
      filters: { dueFilter: "today", completed: "false" },
    },
  });

  console.log("Created 2 saved views");

  // Sharing & collaboration (FEAT-008): share the parent "Launch marketing
  // website" todo with the collaborator as an EDITOR and assign it to them.
  await prisma.todoShare.create({
    data: {
      todoId: parentTodo.id,
      userId: collaborator.id,
      role: "EDITOR",
    },
  });

  await prisma.todo.update({
    where: { id: parentTodo.id },
    data: { assigneeId: collaborator.id },
  });

  await prisma.activityLog.createMany({
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
  await prisma.notification.createMany({
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
