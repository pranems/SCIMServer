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

// ============================================================================
// Phase N3 - JSON + NDJSON format partners.
// ============================================================================
//
// The csv-export module owns the entire client-side export surface as of
// Phase N3. CSV preserves "open-in-Excel" workflows; JSON preserves shape
// exactly (nested objects + arrays + true number/boolean/null types);
// NDJSON is the streaming-friendly format consumed by `jq -s`, the SCIM
// bulk API, and most ETL tools.
//
// Single-file organisation rationale: all three formats share the Blob +
// synthetic-anchor download pattern and the operator picks between them
// from one menu (ExportSplitButton); co-locating them avoids the import
// fan-out cost a separate `json-export.ts` + `ndjson-export.ts` pair
// would introduce.

export interface ToJsonOptions {
  /**
   * Pretty-print with 2-space indent. Default true so the operator can
   * paste the file into a code editor and read it. Set false for the
   * smallest possible byte size (omits whitespace entirely).
   */
  pretty?: boolean;
}

/**
 * Serialize an array of plain objects into a JSON array string.
 *
 * Preserves shape exactly (numbers stay numbers, nested objects stay
 * nested) - this is the key contract that distinguishes JSON export
 * from CSV export which stringifies everything to a cell.
 */
export function toJson(
  rows: ReadonlyArray<Record<string, unknown>>,
  options?: ToJsonOptions,
): string {
  const pretty = options?.pretty !== false;
  return pretty ? JSON.stringify(rows, null, 2) : JSON.stringify(rows);
}

/**
 * Serialize an array of plain objects into newline-delimited JSON
 * (https://github.com/ndjson/ndjson-spec).
 *
 * Contract: each line is independently valid compact JSON. No trailing
 * newline. Empty input -> empty string. JSON.stringify escapes any
 * `\n` inside string values so the line-delimited contract holds even
 * when row content contains literal newlines.
 */
export function toNdjson(
  rows: ReadonlyArray<Record<string, unknown>>,
): string {
  if (rows.length === 0) return '';
  return rows.map((row) => JSON.stringify(row)).join('\n');
}

/**
 * Browser-only helper - drops the given JSON text into a Blob and
 * triggers a download. Mirrors `triggerCsvDownload`'s contract with
 * the `application/json` MIME type.
 */
export function triggerJsonDownload(filename: string, json: string): void {
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * Browser-only helper - drops the given NDJSON text into a Blob and
 * triggers a download. Uses the IANA-registered `application/x-ndjson`
 * MIME type so curl + jq + most ETL tools recognise the format.
 */
export function triggerNdjsonDownload(filename: string, ndjson: string): void {
  const blob = new Blob([ndjson], { type: 'application/x-ndjson;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
