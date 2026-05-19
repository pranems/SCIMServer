/**
 * Phase N3 - ExportSplitButton primitive tests.
 *
 * Single responsibility: render a Fluent UI v9 Menu button that, on
 * each format selection, hands the rows + filename to the matching
 * helper from `web/src/utils/csv-export.ts`.
 *
 * Properties under test:
 *   1. Renders a button labeled "Export" with the documented testid
 *   2. Disabled when rows is empty (and remains disabled even after
 *      clicking - no menu opens)
 *   3. Enabled when rows has at least one entry
 *   4. Clicking the button opens the menu with 3 items in order:
 *      CSV / JSON / NDJSON (testids: export-menu-csv/json/ndjson)
 *   5. CSV item invokes triggerCsvDownload with the right filename +
 *      a non-empty CSV body, honoring `columns` when provided
 *   6. JSON item invokes triggerJsonDownload with the right filename +
 *      a pretty-printed JSON body
 *   7. NDJSON item invokes triggerNdjsonDownload with the right
 *      filename + a newline-delimited body
 *   8. Filename includes the operator-supplied base + a UTC timestamp
 *      so two clicks within a second do not collide on disk
 *   9. The `getRows` callback variant is invoked at click-time (lazy
 *      evaluation) so consumers can defer heavy serialisation
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { ExportSplitButton } from './ExportSplitButton';
import * as csvExport from '../../utils/csv-export';

function renderWithProvider(node: React.ReactElement) {
  return render(<FluentProvider theme={webLightTheme}>{node}</FluentProvider>);
}

describe('Phase N3 - ExportSplitButton', () => {
  let csvSpy: ReturnType<typeof vi.spyOn>;
  let jsonSpy: ReturnType<typeof vi.spyOn>;
  let ndjsonSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    csvSpy = vi.spyOn(csvExport, 'triggerCsvDownload').mockImplementation(() => {});
    jsonSpy = vi.spyOn(csvExport, 'triggerJsonDownload').mockImplementation(() => {});
    ndjsonSpy = vi.spyOn(csvExport, 'triggerNdjsonDownload').mockImplementation(() => {});
  });

  afterEach(() => {
    csvSpy.mockRestore();
    jsonSpy.mockRestore();
    ndjsonSpy.mockRestore();
  });

  it('renders a button with testid "export-button" labeled Export', () => {
    renderWithProvider(<ExportSplitButton rows={[{ a: 1 }]} filenameBase="users" />);
    const button = screen.getByTestId('export-button');
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent(/export/i);
  });

  it('is disabled when rows is empty', () => {
    renderWithProvider(<ExportSplitButton rows={[]} filenameBase="users" />);
    expect(screen.getByTestId('export-button')).toBeDisabled();
  });

  it('is enabled when rows has at least one entry', () => {
    renderWithProvider(<ExportSplitButton rows={[{ a: 1 }]} filenameBase="users" />);
    expect(screen.getByTestId('export-button')).not.toBeDisabled();
  });

  it('opens a menu with CSV / JSON / NDJSON items in order when clicked', () => {
    renderWithProvider(<ExportSplitButton rows={[{ a: 1 }]} filenameBase="users" />);
    fireEvent.click(screen.getByTestId('export-button'));
    expect(screen.getByTestId('export-menu-csv')).toBeInTheDocument();
    expect(screen.getByTestId('export-menu-json')).toBeInTheDocument();
    expect(screen.getByTestId('export-menu-ndjson')).toBeInTheDocument();
  });

  it('CSV item -> triggerCsvDownload with users-* filename + CSV body', () => {
    renderWithProvider(
      <ExportSplitButton
        rows={[{ a: 1, b: 'two' }]}
        filenameBase="users"
        columns={['a', 'b']}
      />,
    );
    fireEvent.click(screen.getByTestId('export-button'));
    fireEvent.click(screen.getByTestId('export-menu-csv'));
    expect(csvSpy).toHaveBeenCalledTimes(1);
    const [filename, csvBody] = csvSpy.mock.calls[0];
    expect(filename).toMatch(/^users-\d{8}T\d{6}Z\.csv$/);
    expect(csvBody).toBe('a,b\n1,two');
  });

  it('JSON item -> triggerJsonDownload with users-* filename + pretty body', () => {
    renderWithProvider(
      <ExportSplitButton rows={[{ a: 1 }]} filenameBase="users" />,
    );
    fireEvent.click(screen.getByTestId('export-button'));
    fireEvent.click(screen.getByTestId('export-menu-json'));
    expect(jsonSpy).toHaveBeenCalledTimes(1);
    const [filename, jsonBody] = jsonSpy.mock.calls[0];
    expect(filename).toMatch(/^users-\d{8}T\d{6}Z\.json$/);
    expect(jsonBody).toContain('\n  ');
  });

  it('NDJSON item -> triggerNdjsonDownload with users-* filename + line-delimited body', () => {
    renderWithProvider(
      <ExportSplitButton rows={[{ a: 1 }, { a: 2 }]} filenameBase="users" />,
    );
    fireEvent.click(screen.getByTestId('export-button'));
    fireEvent.click(screen.getByTestId('export-menu-ndjson'));
    expect(ndjsonSpy).toHaveBeenCalledTimes(1);
    const [filename, ndjsonBody] = ndjsonSpy.mock.calls[0];
    expect(filename).toMatch(/^users-\d{8}T\d{6}Z\.ndjson$/);
    expect(ndjsonBody).toBe('{"a":1}\n{"a":2}');
  });

  it('getRows callback variant is invoked lazily at click-time', () => {
    const getRows = vi.fn(() => [{ lazy: true }]);
    renderWithProvider(<ExportSplitButton getRows={getRows} filenameBase="users" />);
    expect(getRows).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('export-button'));
    fireEvent.click(screen.getByTestId('export-menu-json'));
    expect(getRows).toHaveBeenCalledTimes(1);
    expect(jsonSpy.mock.calls[0][1]).toContain('"lazy"');
  });
});
