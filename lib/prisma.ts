import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PoolConfig } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Decide whether the database connection should be established over TLS.
 *
 * Managed Postgres such as Amazon Aurora/RDS requires TLS. Local development
 * (e.g. the docker-compose Postgres) typically does not use TLS, so we must not
 * force it there or the connection would fail.
 *
 * We enable TLS when the environment explicitly asks for it (`DB_SSL=require`
 * for the discrete-params path, or `sslmode=require` in a `DATABASE_URL`) or
 * when running in production.
 *
 * `rejectUnauthorized: false` is a pragmatic choice here: Aurora is only
 * reachable over a private VPC egress connector (encrypted transport over a
 * private network), and bundling/verifying the RDS CA chain is not required for
 * that threat model. Local non-TLS dev is unaffected because `ssl` stays unset.
 */
function tlsRequired(signal: boolean): PoolConfig["ssl"] {
  const requiresTls = signal || process.env.NODE_ENV === "production";

  if (!requiresTls) {
    return undefined;
  }

  return { rejectUnauthorized: false };
}

/**
 * Build the pg connection config for the PrismaPg adapter.
 *
 * Production (the Lambda Web Function) passes DISCRETE connection parameters
 * (`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL`). We feed
 * those to pg as literals so the RDS-managed master password — which can
 * contain URL-unsafe characters (e.g. `! # $ ( - [ _`) — never has to survive
 * WHATWG URL parsing. Assembling a `postgresql://user:password@host/db` URL from
 * such a password fails to parse in the pg driver; discrete params avoid that.
 *
 * Local development (docker-compose) sets a single `DATABASE_URL`, so when the
 * discrete `DB_HOST` is absent we fall back to the connection-string path.
 */
function resolvePoolConfig(): PoolConfig {
  if (process.env.DB_HOST) {
    const ssl = tlsRequired(process.env.DB_SSL === "require");

    return {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT ?? 5432),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ...(ssl ? { ssl } : {}),
    };
  }

  const connectionString = process.env.DATABASE_URL!;
  const ssl = tlsRequired(/[?&]sslmode=require/i.test(connectionString));

  return ssl ? { connectionString, ssl } : { connectionString };
}

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg(resolvePoolConfig());
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
