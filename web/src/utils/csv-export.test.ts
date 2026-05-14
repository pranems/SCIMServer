/**
 * Phase L6 - csv-export utility tests.
 *
 * Pure module with one job: turn an array of plain objects (or arrays
 * of column tuples) into a single RFC 4180-compliant CSV string the
 * browser can hand to the operator via a Blob + an <a download>.
 *
 * Properties under test:
 *   1. Header row is the union of all keys in row order
 *   2. Numbers / booleans / null / undefined are rendered safely
 *   3. Strings containing commas / quotes / newlines are quoted +
 *      doubled-quote-escaped per RFC 4180
 *   4. Row order is stable (no implicit sort)
 *   5. Empty input emits the header row only when columns are
 *      explicitly provided; truly empty (no rows + no columns) emits
 *      the empty string
 *   6. `columns` override pins ordering AND filters out unwanted keys
 *   7. CRLF line terminator (RFC 4180 strict mode) - opt-in
 *   8. The companion `triggerCsvDownload(filename, csv)` helper writes
 *      to a Blob and clicks a synthetic <a> with `download=` set.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toCsv, triggerCsvDownload } from './csv-export';

describe('Phase L6 - toCsv (pure RFC 4180 serializer)', () => {
  it('empty rows + no columns -> empty string', () => {
    expect(toCsv([])).toBe('');
  });

  it('empty rows + explicit columns -> header row only', () => {
    expect(toCsv([], { columns: ['a', 'b'] })).toBe('a,b');
  });

  it('infers columns from union of keys when not provided', () => {
    const csv = toCsv([
      { a: 1, b: 2 },
      { a: 3, c: 4 },
    ]);
    const lines = csv.split('\n');
    // First line is the header; subsequent lines are rows.
    expect(lines[0].split(',').sort()).toEqual(['a', 'b', 'c']);
    expect(lines).toHaveLength(3);
  });

  it('preserves row order (no implicit sort)', () => {
    const csv = toCsv(
      [{ k: 'z' }, { k: 'a' }, { k: 'm' }],
      { columns: ['k'] },
    );
    expect(csv).toBe('k\nz\na\nm');
  });

  it('renders booleans as true/false and numbers as decimal', () => {
    const csv = toCsv(
      [{ active: true, count: 42, ratio: 1.5, missing: false }],
      { columns: ['active', 'count', 'ratio', 'missing'] },
    );
    expect(csv).toBe('active,count,ratio,missing\ntrue,42,1.5,false');
  });

  it('renders null and undefined as empty cells', () => {
    const csv = toCsv(
      [{ a: null, b: undefined, c: '' }],
      { columns: ['a', 'b', 'c'] },
    );
    expect(csv).toBe('a,b,c\n,,');
  });

  it('quotes strings containing a comma', () => {
    const csv = toCsv(
      [{ name: 'Doe, John' }],
      { columns: ['name'] },
    );
    expect(csv).toBe('name\n"Doe, John"');
  });

  it('quotes strings containing a double-quote and doubles the quote per RFC 4180', () => {
    const csv = toCsv(
      [{ name: 'She said "hi"' }],
      { columns: ['name'] },
    );
    expect(csv).toBe('name\n"She said ""hi"""');
  });

  it('quotes strings containing a newline', () => {
    const csv = toCsv(
      [{ note: 'line1\nline2' }],
      { columns: ['note'] },
    );
    expect(csv).toBe('note\n"line1\nline2"');
  });

  it('renders complex nested values via JSON.stringify (so the cell is a string the spreadsheet can show)', () => {
    const csv = toCsv(
      [{ tags: ['a', 'b'] }],
      { columns: ['tags'] },
    );
    // JSON-stringify -> ["a","b"] which contains commas + quotes -> gets quoted + doubled.
    expect(csv).toBe('tags\n"[""a"",""b""]"');
  });

  it('opt-in crlf:true uses \\r\\n line terminator (strict RFC 4180)', () => {
    const csv = toCsv(
      [{ a: 1 }, { a: 2 }],
      { columns: ['a'], crlf: true },
    );
    expect(csv).toBe('a\r\n1\r\n2');
  });

  it('columns override pins ordering AND filters out unwanted keys', () => {
    const csv = toCsv(
      [{ z: 'last', a: 'first', secret: 'keep me out' }],
      { columns: ['a', 'z'] },
    );
    expect(csv).toBe('a,z\nfirst,last');
  });
});

describe('Phase L6 - triggerCsvDownload', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let appendChild: ReturnType<typeof vi.fn>;
  let removeChild: ReturnType<typeof vi.fn>;
  let clicked: HTMLAnchorElement[];

  beforeEach(() => {
    clicked = [];
    createObjectURL = vi.fn(() => 'blob:fake-url');
    revokeObjectURL = vi.fn();
    appendChild = vi.fn();
    removeChild = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      value: createObjectURL,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: revokeObjectURL,
      writable: true,
      configurable: true,
    });
    // Spy on document.body.appendChild + removeChild so the test asserts
    // the helper actually inserts the synthetic anchor.
    vi.spyOn(document.body, 'appendChild').mockImplementation(((node: Node) => {
      appendChild(node);
      if ((node as HTMLAnchorElement).tagName === 'A') {
        clicked.push(node as HTMLAnchorElement);
      }
      return node;
    }) as typeof document.body.appendChild);
    vi.spyOn(document.body, 'removeChild').mockImplementation(((node: Node) => {
      removeChild(node);
      return node;
    }) as typeof document.body.removeChild);
  });

  it('creates a Blob with text/csv MIME type and an anchor with the given filename + click()s it', () => {
    triggerCsvDownload('test.csv', 'a,b\n1,2');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blobArg = createObjectURL.mock.calls[0][0] as Blob;
    expect(blobArg).toBeInstanceOf(Blob);
    expect(blobArg.type).toContain('text/csv');
    expect(appendChild).toHaveBeenCalledTimes(1);
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe('test.csv');
    expect(clicked[0].href).toContain('blob:fake-url');
  });

  it('revokes the object URL after the click to free memory', () => {
    triggerCsvDownload('test.csv', 'a\n1');
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });

  it('removes the synthetic anchor from the DOM after the click (no leak)', () => {
    triggerCsvDownload('test.csv', 'a\n1');
    expect(removeChild).toHaveBeenCalledTimes(1);
  });
});
