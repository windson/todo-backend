import { beforeEach, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";

/**
 * Deeply-mocked Prisma client. Route handlers import the real singleton from
 * `@/lib/prisma`; the module mock below swaps that singleton for this proxy so
 * tests never touch a live database.
 */
export const prismaMock: DeepMockProxy<PrismaClient> =
  mockDeep<PrismaClient>();

vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
}));

beforeEach(() => {
  mockReset(prismaMock);
});
