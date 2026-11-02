/**
 * Global Vitest setup for backend unit tests.
 *
 * Tests run without a live database: Prisma is mocked via
 * `tests/helpers/prisma-mock.ts`. We still provide a dummy DATABASE_URL so any
 * incidental access to the env var does not throw.
 */
process.env.DATABASE_URL ??=
  "postgresql://todouser:todopass@localhost:5432/tododb";
