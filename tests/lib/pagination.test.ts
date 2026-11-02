import { describe, it, expect } from "vitest";
import { buildLinkHeader, paginationHeaders } from "@/lib/pagination";

function rels(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(", ")) {
    const match = part.match(/^<([^>]+)>; rel="([^"]+)"$/);
    if (match) out[match[2]] = match[1];
  }
  return out;
}

describe("buildLinkHeader (RFC 5988)", () => {
  it("emits first/last/next on the first page of a multi-page set", () => {
    const header = buildLinkHeader({
      url: "http://localhost/api/todos?completed=false&limit=20&offset=0",
      limit: 20,
      offset: 0,
      total: 55,
    });
    const r = rels(header);

    expect(new URL(r.first).searchParams.get("offset")).toBe("0");
    // last page starts at offset 40 (items 41-55).
    expect(new URL(r.last).searchParams.get("offset")).toBe("40");
    expect(new URL(r.next).searchParams.get("offset")).toBe("20");
    // No prev on the first page.
    expect(r.prev).toBeUndefined();
    // Existing filters are preserved on every link.
    expect(new URL(r.next).searchParams.get("completed")).toBe("false");
  });

  it("emits prev/next on a middle page and prev (no next) on the last page", () => {
    const middle = rels(
      buildLinkHeader({ url: "http://localhost/api/todos", limit: 20, offset: 20, total: 55 })
    );
    expect(new URL(middle.prev).searchParams.get("offset")).toBe("0");
    expect(new URL(middle.next).searchParams.get("offset")).toBe("40");

    const last = rels(
      buildLinkHeader({ url: "http://localhost/api/todos", limit: 20, offset: 40, total: 55 })
    );
    expect(new URL(last.prev).searchParams.get("offset")).toBe("20");
    expect(last.next).toBeUndefined();
  });

  it("emits only first/last when everything fits on one page", () => {
    const r = rels(
      buildLinkHeader({ url: "http://localhost/api/todos", limit: 20, offset: 0, total: 5 })
    );
    expect(r.next).toBeUndefined();
    expect(r.prev).toBeUndefined();
    expect(new URL(r.last).searchParams.get("offset")).toBe("0");
  });
});

describe("paginationHeaders", () => {
  it("always sets X-Total-Count and adds Link when there are relations", () => {
    const headers = paginationHeaders({
      url: "http://localhost/api/todos",
      limit: 20,
      offset: 0,
      total: 55,
    });
    expect(headers["X-Total-Count"]).toBe("55");
    expect(headers.Link).toContain('rel="next"');
  });
});
