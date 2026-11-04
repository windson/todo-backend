import { describe, it, expect, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { parseOrigins, buildAllowedOrigins, csrfViolation } from "@/lib/cors";

const SPA = "https://spa.example.com";

function req(method: string, headers: Record<string, string> = {}, body?: string) {
  return new NextRequest(
    new Request("https://api.example.com/api/todos", { method, headers, body }),
  );
}

describe("parseOrigins / buildAllowedOrigins", () => {
  it("trims, strips trailing slashes and drops empty entries", () => {
    expect(parseOrigins(" https://a.example.com/ , ,https://b.example.com//")).toEqual([
      "https://a.example.com",
      "https://b.example.com",
    ]);
    expect(parseOrigins(undefined)).toEqual([]);
  });

  it("includes localhost origins outside production", () => {
    expect(buildAllowedOrigins(SPA, "development")).toEqual([
      "http://localhost:5173",
      "http://localhost:3000",
      SPA,
    ]);
  });

  it("drops localhost origins in production", () => {
    expect(buildAllowedOrigins(`${SPA}/`, "production")).toEqual([SPA]);
    expect(buildAllowedOrigins(undefined, "production")).toEqual([]);
  });
});

describe("csrfViolation", () => {
  const allowed = [SPA];

  it("ignores safe methods", () => {
    expect(csrfViolation(req("GET", { origin: "https://evil.example" }), allowed)).toBeNull();
  });

  it("rejects an unsafe request from a disallowed origin", () => {
    expect(
      csrfViolation(req("POST", { origin: "https://evil.example" }), allowed),
    ).toMatch(/not allowed/);
  });

  it("allows an allowed origin with a JSON body", () => {
    const r = req("POST", { origin: SPA, "content-type": "application/json" }, "{}");
    expect(csrfViolation(r, allowed)).toBeNull();
  });

  it("allows JSON with a charset and CSV bodies", () => {
    expect(
      csrfViolation(req("PUT", { "content-type": "application/json; charset=utf-8" }, "{}"), allowed),
    ).toBeNull();
    expect(csrfViolation(req("POST", { "content-type": "text/csv" }, "a,b"), allowed)).toBeNull();
  });

  it("rejects form-style content types with a body", () => {
    for (const ct of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
      expect(
        csrfViolation(req("POST", { origin: SPA, "content-type": ct }, "x=1"), allowed),
      ).toMatch(/content type/);
    }
  });

  it("accepts a non-JSON body when the custom header is present", () => {
    const r = req("POST", { "content-type": "text/plain", "x-requested-with": "fetch" }, "x");
    expect(csrfViolation(r, allowed)).toBeNull();
  });

  it("allows requests without a content type from an allowed origin and non-browser clients", () => {
    expect(csrfViolation(req("DELETE", { origin: SPA }), allowed)).toBeNull();
    expect(csrfViolation(req("POST"), allowed)).toBeNull();
  });
});

describe("proxy CORS behaviour", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadProxy(corsEnv: string, nodeEnv: string) {
    vi.resetModules();
    vi.stubEnv("CORS_ALLOWED_ORIGINS", corsEnv);
    vi.stubEnv("NODE_ENV", nodeEnv);
    return (await import("@/proxy")).proxy;
  }

  it("reflects only allowed origins and sets Vary: Origin", async () => {
    const proxy = await loadProxy(SPA, "production");
    const ok = await proxy(req("OPTIONS", { origin: SPA }));
    expect(ok.headers.get("access-control-allow-origin")).toBe(SPA);
    expect(ok.headers.get("vary")).toContain("Origin");
    const bad = await proxy(req("OPTIONS", { origin: "http://localhost:5173" }));
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
    expect(bad.headers.get("vary")).toContain("Origin");
  });

  it("returns 403 for unsafe requests from a disallowed origin, even on public paths", async () => {
    const proxy = await loadProxy(SPA, "production");
    const r = new NextRequest(
      new Request("https://api.example.com/api/auth/login", {
        method: "POST",
        headers: { origin: "https://evil.example", "content-type": "application/json" },
        body: "{}",
      }),
    );
    const res = await proxy(r);
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("vary")).toContain("Origin");
  });

  it("lets the SPA origin through to login", async () => {
    const proxy = await loadProxy(SPA, "production");
    const r = new NextRequest(
      new Request("https://api.example.com/api/auth/login", {
        method: "POST",
        headers: { origin: SPA, "content-type": "application/json" },
        body: "{}",
      }),
    );
    const res = await proxy(r);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(SPA);
  });
});
