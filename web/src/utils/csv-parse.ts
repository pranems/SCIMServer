/**
 * Phase M2 - csv-parse (pure RFC 4180 reader).
 *
 * Reverse of [csv-export.ts](./csv-export.ts). Reads the header + body
 * rows of a CSV string into typed objects keyed by header name. Used
 * by Phase M2 BulkPage to ingest the operator's uploaded CSV file.
 *
 * Why hand-rolled (no dependency): the SCIM admin row sets are small
 * (operator uploads a few hundred rows at most) and the algorithm is
 * the standard RFC 4180 state machine - quoted vs unquoted, doubled
 * quote escape, embedded newlines inside quoted cells. Pulling
 * papaparse just for this would dominate the BulkPage chunk.
 *
 * @see web/src/utils/csv-parse.test.ts (TDD spec)
 * @see web/src/utils/csv-export.ts (the inverse)
 * @see docs/PHASE_M2_BULK_OPERATIONS.md
 */

export interface CsvParseResult {
  headers: string[];
  /** One record per body row, keyed by header name. Values are strings. */
  rows: Array<Record<string, string>>;
  /** Set when the input was malformed (e.g. unbalanced quote). */
  error?: string;
}

interface TokenizeResult {
  /** Raw rows (each row is an array of cell strings). headers + body. */
  raw: string[][];
  error?: string;
}

/**
 * Tokenize a CSV string into rows of cells per RFC 4180.
 *
 * State machine:
 *   - outside-quote: consume chars; comma -> next cell; LF/CRLF -> next row
 *   - inside-quote:  consume chars including comma+newline; double-quote
 *                    means either end-of-cell (next char != ") or escaped
 *                    quote (next char == ")
 *   - end-of-input inside-quote -> error (unbalanced quote)
 */
function tokenize(input: string): TokenizeResult {
  const raw: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuote = false;
  let i = 0;
  const len = input.length;

  // Helper: commit cell + reset.
  const endCell = (): void => {
    row.push(cell);
    cell = '';
  };
  const endRow = (): void => {
    endCell();
    raw.push(row);
    row = [];
  };

  while (i < len) {
    const ch = input[i];

    if (inQuote) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          // Escaped doubled quote.
          cell += '"';
          i += 2;
          continue;
        }
        // End of quoted cell.
        inQuote = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }

    // outside-quote
    if (ch === '"') {
      // Allow only at start of cell.
      if (cell.length !== 0) {
        return { raw: [], error: `Unexpected quote at offset ${i}` };
      }
      inQuote = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      endCell();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      // CRLF: skip the \n.
      if (input[i + 1] === '\n') {
        endRow();
        i += 2;
        continue;
      }
      endRow();
      i += 1;
      continue;
    }
    if (ch === '\n') {
      endRow();
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }

  if (inQuote) {
    return { raw: [], error: 'Unbalanced quote at end of input' };
  }

  // Flush trailing partial row UNLESS it's empty (trailing newline case).
  if (cell.length > 0 || row.length > 0) {
    endRow();
  }

  return { raw };
}

export function parseCsv(input: string): CsvParseResult {
  if (!input || input.length === 0) {
    return { headers: [], rows: [] };
  }
  const { raw, error } = tokenize(input);
  if (error) {
    return { headers: [], rows: [], error };
  }
  if (raw.length === 0) {
    return { headers: [], rows: [] };
  }
  const headers = raw[0];
  const rows: Array<Record<string, string>> = [];
  for (let r = 1; r < raw.length; r++) {
    const cells = raw[r];
    // Skip phantom empty row that can result from trailing newline.
    if (cells.length === 1 && cells[0] === '') continue;
    const record: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      record[headers[c]] = cells[c] ?? '';
    }
    rows.push(record);
  }
  return { headers, rows };
}
