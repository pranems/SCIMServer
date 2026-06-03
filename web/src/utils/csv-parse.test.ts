/**
 * Phase M2 - csv-parse pure module tests.
 *
 * RFC 4180 reverse of csv-export.ts. Reads the header row + body rows
 * of a CSV string into typed objects. Used by Phase M2 BulkPage to
 * ingest the operator's uploaded CSV file.
 *
 * Properties under test:
 *   1. Empty input -> empty rows + empty headers
 *   2. Header-only -> empty rows
 *   3. Single row -> headers from row 0, one record
 *   4. Multiple rows -> stable header order, one record per row
 *   5. Quoted cells preserve embedded commas
 *   6. Quoted cells unescape doubled double-quotes per RFC 4180
 *   7. Quoted cells preserve embedded newlines (multi-line cells)
 *   8. CRLF + LF line terminators both work
 *   9. Trailing newline does NOT emit a phantom empty row
 *   10. Cells with only whitespace are preserved as the literal string
 *   11. Round-trip with toCsv: parseCsv(toCsv(rows)) === rows
 *   12. Malformed input (unbalanced quote) returns null + sets error
 */
import { describe, it, expect } from 'vitest';
import { parseCsv } from './csv-parse';
import { toCsv } from './csv-export';

describe('Phase M2 - parseCsv (pure RFC 4180 reader)', () => {
  it('empty input -> empty headers + empty rows', () => {
    const r = parseCsv('');
    expect(r.headers).toEqual([]);
    expect(r.rows).toEqual([]);
    expect(r.error).toBeUndefined();
  });

  it('header-only -> headers populated, rows empty', () => {
    const r = parseCsv('a,b,c');
    expect(r.headers).toEqual(['a', 'b', 'c']);
    expect(r.rows).toEqual([]);
  });

  it('single body row -> one record with header keys', () => {
    const r = parseCsv('a,b\n1,2');
    expect(r.headers).toEqual(['a', 'b']);
    expect(r.rows).toEqual([{ a: '1', b: '2' }]);
  });

  it('multiple body rows -> one record per row', () => {
    const r = parseCsv('a,b\n1,2\n3,4\n5,6');
    expect(r.rows).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
      { a: '5', b: '6' },
    ]);
  });

  it('quoted cell preserves embedded comma', () => {
    const r = parseCsv('name,note\n"Doe, John","ok"');
    expect(r.rows).toEqual([{ name: 'Doe, John', note: 'ok' }]);
  });

  it('quoted cell unescapes doubled double-quotes per RFC 4180', () => {
    const r = parseCsv('q\n"She said ""hi"""');
    expect(r.rows).toEqual([{ q: 'She said "hi"' }]);
  });

  it('quoted cell preserves embedded LF (multi-line cells)', () => {
    const r = parseCsv('note\n"line1\nline2"');
    expect(r.rows).toEqual([{ note: 'line1\nline2' }]);
  });

  it('CRLF line terminator works (Windows-saved CSV)', () => {
    const r = parseCsv('a,b\r\n1,2\r\n3,4');
    expect(r.rows).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  it('trailing newline does not emit a phantom empty row', () => {
    const r = parseCsv('a\n1\n2\n');
    expect(r.rows).toEqual([{ a: '1' }, { a: '2' }]);
  });

  it('whitespace-only cells preserved as literal string', () => {
    const r = parseCsv('a,b\n   ,4');
    expect(r.rows).toEqual([{ a: '   ', b: '4' }]);
  });

  it('missing trailing cells in a body row default to empty string', () => {
    const r = parseCsv('a,b,c\n1,2');
    expect(r.rows).toEqual([{ a: '1', b: '2', c: '' }]);
  });

  it('extra body cells beyond header count are dropped (defensive)', () => {
    const r = parseCsv('a,b\n1,2,3,4');
    expect(r.rows).toEqual([{ a: '1', b: '2' }]);
  });

  it('malformed input (unbalanced quote) returns error string + null rows', () => {
    const r = parseCsv('a,b\n"unclosed,2');
    expect(r.error).toBeTruthy();
    expect(r.rows).toEqual([]);
  });

  it('round-trip: toCsv -> parseCsv yields the same string-shaped data', () => {
    const original = [
      { name: 'Alice', note: 'Doe, John' },
      { name: 'Bob', note: 'She said "hi"' },
      { name: 'Carol', note: 'line1\nline2' },
    ];
    const csv = toCsv(original);
    const parsed = parseCsv(csv);
    expect(parsed.rows).toEqual(original);
  });
});
