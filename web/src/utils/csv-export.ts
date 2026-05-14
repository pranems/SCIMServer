/**
 * Phase L6 - CSV export utility (pure module).
 *
 * Single responsibility: turn an array of plain objects into an
 * RFC 4180 CSV string, plus a thin browser-only helper that wraps the
 * Blob + synthetic anchor + revokeObjectURL boilerplate.
 *
 * Why a hand-rolled tiny implementation rather than a CSV dependency:
 * the redesigned UI has zero csv deps today; pulling one (papaparse is
 * ~45 KB gz, csv-stringify is ~6 KB gz but ships node-only APIs) just
 * to format ~5-100 row exports would dominate the route chunk. The
 * SCIM admin surface produces small, well-shaped row sets, so the
 * full RFC 4180 escape table (commas / quotes / newlines / doubling)
 * is the entire contract.
 *
 * @see docs/PHASE_L6_OPERATIONS_VIEW.md
 * @see web/src/utils/csv-export.test.ts (TDD spec)
 */

export interface ToCsvOptions {
  /**
   * Pin the column order AND filter the output. When omitted, the
   * columns are inferred as the union of keys across all rows in
   * first-seen order.
   */
  columns?: readonly string[];
  /**
   * Use the strict RFC 4180 `\r\n` line terminator. Defaults to `\n`
   * which Excel + Numbers + LibreOffice all accept.
   */
  crlf?: boolean;
}

const CRLF = '\r\n';
const LF = '\n';
const NEEDS_QUOTING = /[",\r\n]/;

/**
 * Format a single cell value to its CSV-escaped string form.
 *
 * - undefined / null -> empty cell
 * - boolean -> 'true' / 'false'
 * - number -> String(n) (handles NaN as 'NaN', which is intentional)
 * - string -> RFC 4180 quote-if-needed + double-quote-escape
 * - everything else (object / array) -> JSON.stringify then escape
 */
function formatCell(value: unknown): string {
  if (value === undefined || value === null) return '';
  let str: string;
  if (typeof value === 'string') {
    str = value;
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    str = String(value);
  } else {
    // Object / array fallback so the operator sees something readable
    // rather than '[object Object]'.
    try {
      str = JSON.stringify(value);
    } catch {
      str = String(value);
    }
  }
  if (NEEDS_QUOTING.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Serialize an array of plain objects into an RFC 4180 CSV string.
 *
 * Stable / deterministic - row order is preserved verbatim.
 */
export function toCsv(
  rows: ReadonlyArray<Record<string, unknown>>,
  options?: ToCsvOptions,
): string {
  const terminator = options?.crlf ? CRLF : LF;

  let columns: readonly string[];
  if (options?.columns) {
    columns = options.columns;
  } else if (rows.length === 0) {
    return '';
  } else {
    const seen = new Set<string>();
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (!seen.has(key)) seen.add(key);
      }
    }
    columns = Array.from(seen);
  }

  const headerLine = columns.map((c) => formatCell(c)).join(',');
  if (rows.length === 0) return headerLine;

  const bodyLines = rows.map((row) =>
    columns.map((c) => formatCell(row[c])).join(','),
  );
  return [headerLine, ...bodyLines].join(terminator);
}

/**
 * Browser-only helper: drops the given CSV text into a Blob and
 * triggers a download via a synthetic anchor element. Cleans up the
 * Object URL + the anchor on the same tick to avoid leaks.
 *
 * Not exported as `default` so the pure `toCsv` can be unit-tested
 * without a DOM mock.
 */
export function triggerCsvDownload(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  // The element must be in the DOM for some browsers to honour
  // click(); insert + remove on the same synchronous tick.
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
