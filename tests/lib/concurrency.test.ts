import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import {
  assertUnmodified,
  resolveExpectedVersion,
  resolveExpectedVersionFromHeader,
  IF_UNMODIFIED_SINCE_HEADER,
} from "@/lib/concurrency";
import { ApiError } from "@/lib/errors";

function req(headers?: Record<string, string>): NextRequest {
  return new NextRequest(new Request("http://localhost/api/todos/t1", { headers }));
}

describe("assertUnmodified", () => {
  const current = new Date("2024-01-01T00:00:00.000Z");

  it("is a no-op when no token is supplied (backward compatible)", () => {
    expect(() => assertUnmodified(null, current)).not.toThrow();
  });

  it("passes when the expected version matches the current updatedAt", () => {
    expect(() => assertUnmodified(current.getTime(), current)).not.toThrow();
  });

  it("throws 409 when the record changed since the expected version", () => {
    const stale = new Date("2023-12-31T00:00:00.000Z").getTime();
    try {
      assertUnmodified(stale, current);
      throw new Error("expected a conflict");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).statusCode).toBe(409);
    }
  });

  it("tolerates sub-second differences (second precision for HTTP-date tokens)", () => {
    const current2 = new Date("2024-01-01T00:00:00.500Z");
    const expectedSecondPrecision = new Date("2024-01-01T00:00:00.000Z").getTime();
    expect(() => assertUnmodified(expectedSecondPrecision, current2)).not.toThrow();
  });
});

describe("resolveExpectedVersion", () => {
  it("returns null when neither body field nor header is present", () => {
    expect(resolveExpectedVersion(req(), {})).toBeNull();
  });

  it("reads the body field (ISO string) in preference to the header", () => {
    const ms = resolveExpectedVersion(req(), {
      expectedUpdatedAt: "2024-01-01T00:00:00.000Z",
    });
    expect(ms).toBe(Date.parse("2024-01-01T00:00:00.000Z"));
  });

  it("reads the If-Unmodified-Since header when no body field is present", () => {
    const headerValue = new Date("2024-01-01T00:00:00.000Z").toUTCString();
    const ms = resolveExpectedVersion(
      req({ [IF_UNMODIFIED_SINCE_HEADER]: headerValue }),
      {}
    );
    expect(ms).toBe(Date.parse(headerValue));
  });

  it("throws 400 when the supplied token is unparseable", () => {
    expect(() => resolveExpectedVersion(req(), { expectedUpdatedAt: "not-a-date" })).toThrow(
      ApiError
    );
  });
});

describe("resolveExpectedVersionFromHeader", () => {
  it("returns null without the header and the parsed ms with it", () => {
    expect(resolveExpectedVersionFromHeader(req())).toBeNull();
    const headerValue = new Date("2024-01-01T00:00:00.000Z").toUTCString();
    expect(
      resolveExpectedVersionFromHeader(req({ [IF_UNMODIFIED_SINCE_HEADER]: headerValue }))
    ).toBe(Date.parse(headerValue));
  });
});
