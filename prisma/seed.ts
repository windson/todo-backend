import { PrismaClient, Priority } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding database...");

  // Clean existing data
  await prisma.todoTag.deleteMany();
  await prisma.todo.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.category.deleteMany();

  // Create categories
  const categories = await Promise.all([
    prisma.category.create({
      data: { name: "Work", color: "#3B82F6" },
    }),
    prisma.category.create({
      data: { name: "Personal", color: "#10B981" },
    }),
    prisma.category.create({
      data: { name: "Shopping", color: "#F59E0B" },
    }),
    prisma.category.create({
      data: { name: "Health", color: "#EF4444" },
    }),
  ]);

  console.log(`Created ${categories.length} categories`);

  // Create tags
  const tags = await Promise.all([
    prisma.tag.create({
      data: { name: "important", color: "#DC2626" },
    }),
    prisma.tag.create({
      data: { name: "quick-win", color: "#16A34A" },
    }),
    prisma.tag.create({
      data: { name: "blocked", color: "#9333EA" },
    }),
    prisma.tag.create({
      data: { name: "review", color: "#2563EB" },
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
        tags: tagIds.length > 0
          ? { create: tagIds.map((tagId) => ({ tagId })) }
          : undefined,
      },
    });
  }

  console.log(`Created ${todosData.length} todos`);
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
