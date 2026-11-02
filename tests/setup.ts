/**
 * Global Vitest setup for backend unit tests.
 *
 * Tests run without a live database: Prisma is mocked via
 * `tests/helpers/prisma-mock.ts`. We still provide a dummy DATABASE_URL so any
 * incidental access to the env var does not throw.
 */
process.env.DATABASE_URL ??=
  "postgresql://todouser:todopass@localhost:5432/tododb";

// Keep test output clean: silence the structured per-request logger (FEAT-010)
// unless a test explicitly re-enables it. Rate limiting stays disabled by
// default (RATE_LIMIT_ENABLED unset) so the many-requests test suite is not
// throttled; the rate-limit tests opt in and reset the limiter themselves.
process.env.REQUEST_LOG_ENABLED ??= "false";
