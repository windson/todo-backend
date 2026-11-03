import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PoolConfig } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Decide whether the database connection should be established over TLS.
 *
 * Managed Postgres such as Amazon Aurora/RDS requires TLS, and the connection
 * string carries `sslmode=require` in that case. Local development (e.g. the
 * docker-compose Postgres) typically does not use TLS, so we must not force it
 * there or the connection would fail.
 *
 * We enable TLS when the connection string explicitly asks for it
 * (`sslmode=require`) or when running in production. Passing the raw
 * connection string alone does not reliably configure node-postgres SSL, so we
 * build an explicit pg config and set `ssl` deterministically.
 *
 * `rejectUnauthorized: false` is a pragmatic choice here: Aurora is only
 * reachable over a private VPC egress connector (encrypted transport over a
 * private network), and bundling/verifying the RDS CA chain is not required for
 * that threat model. Local non-TLS dev is unaffected because `ssl` stays unset.
 */
function resolveSslConfig(connectionString: string): PoolConfig["ssl"] {
  const requiresTls =
    /[?&]sslmode=require/i.test(connectionString) ||
    process.env.NODE_ENV === "production";

  if (!requiresTls) {
    return undefined;
  }

  return { rejectUnauthorized: false };
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL!;
  const ssl = resolveSslConfig(connectionString);

  const config: PoolConfig = ssl
    ? { connectionString, ssl }
    : { connectionString };

  const adapter = new PrismaPg(config);
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
