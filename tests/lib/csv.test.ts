import { describe, it, expect } from "vitest";
import { escapeCsvField, toCsv, parseCsv } from "@/lib/csv";

describe("escapeCsvField", () => {
  it("leaves plain values unquoted", () => {
    expect(escapeCsvField("hello")).toBe("hello");
    expect(escapeCsvField(42)).toBe("42");
  });

  it("returns empty string for null/undefined", () => {
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField(undefined)).toBe("");
  });

  it("quotes and escapes commas, quotes, and newlines", () => {
    expect(escapeCsvField("a,b")).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("toCsv", () => {
  it("writes a header row and escapes fields", () => {
    const csv = toCsv(["title", "note"], [
      { title: "Buy milk", note: "2%, skim" },
      { title: 'Say "hi"', note: "line1\nline2" },
    ]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("title,note");
    expect(lines[1]).toBe('Buy milk,"2%, skim"');
    expect(lines[2]).toBe('"Say ""hi""","line1\nline2"');
  });
});

describe("parseCsv", () => {
  it("round-trips values with commas, quotes, and newlines", () => {
    const csv = toCsv(["title", "note"], [
      { title: "Buy milk", note: "2%, skim" },
      { title: 'Say "hi"', note: "line1\nline2" },
    ]);
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ title: "Buy milk", note: "2%, skim" });
    expect(rows[1]).toEqual({ title: 'Say "hi"', note: "line1\nline2" });
  });

  it("handles LF-only line endings and a trailing newline", () => {
    const rows = parseCsv("title,done\na,true\nb,false\n");
    expect(rows).toEqual([
      { title: "a", done: "true" },
      { title: "b", done: "false" },
    ]);
  });

  it("returns an empty array when there is only a header", () => {
    expect(parseCsv("title,done\n")).toEqual([]);
  });

  it("skips blank lines between records", () => {
    const rows = parseCsv("title\na\n\nb\n");
    expect(rows).toEqual([{ title: "a" }, { title: "b" }]);
  });
});
