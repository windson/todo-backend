/**
 * Minimal, dependency-free CSV reader/writer following RFC 4180 quoting rules.
 * Used by the export (/api/export?format=csv) and import (/api/import) routes so
 * we avoid adding a native/heavy CSV dependency. Fields that contain a comma,
 * double-quote, or newline are wrapped in double quotes and embedded quotes are
 * doubled. Parsing handles quoted fields with embedded delimiters/newlines.
 */

/** Escape a single CSV field, quoting it when it contains special characters. */
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Serialize an array of row objects to a CSV string. `columns` fixes the
 * header order; each row supplies values keyed by column name. A trailing
 * newline is included so appended content stays on its own line.
 */
export function toCsv<T extends Record<string, unknown>>(
  columns: readonly string[],
  rows: readonly T[]
): string {
  const lines: string[] = [];
  lines.push(columns.map(escapeCsvField).join(","));
  for (const row of rows) {
    lines.push(columns.map((col) => escapeCsvField(row[col])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

/**
 * Parse a CSV string into an array of records keyed by the header row. Handles
 * quoted fields (with embedded commas, quotes, and newlines), both CRLF and LF
 * line endings, and a trailing newline. Returns an empty array when there is no
 * data beyond the header.
 */
export function parseCsv(input: string): Record<string, string>[] {
  const rows = parseCsvRows(input);
  if (rows.length === 0) return [];
  const header = rows[0];
  const records: Record<string, string>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    // Skip blank lines (a single empty cell with nothing else).
    if (cells.length === 1 && cells[0] === "") continue;
    const record: Record<string, string> = {};
    header.forEach((key, idx) => {
      record[key] = cells[idx] ?? "";
    });
    records.push(record);
  }
  return records;
}

/** Tokenize a CSV document into an array of rows, each an array of cells. */
function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      pushField();
      i++;
      continue;
    }
    if (ch === "\r") {
      // Treat CRLF and lone CR as a single row break.
      pushRow();
      if (input[i + 1] === "\n") i += 2;
      else i++;
      continue;
    }
    if (ch === "\n") {
      pushRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }

  // Flush the final field/row unless the input ended exactly on a row break
  // (which already pushed the row and left nothing buffered).
  if (field.length > 0 || row.length > 0) {
    pushRow();
  }

  return rows;
}
