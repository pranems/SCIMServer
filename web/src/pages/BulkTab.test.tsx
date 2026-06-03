/**
 * BulkTab tests (Phase M2).
 *
 * Asserts:
 *   1. Page renders with mode picker (POST/PATCH/DELETE) + resource picker (Users/Groups)
 *   2. Drop-zone accepts a CSV file via change-event; parsed headers
 *      populate the mapping panel
 *   3. Mapping panel: each parsed CSV column gets a target-attribute select
 *   4. Preview panel: shows the assembled BulkRequest envelope (first 10 ops)
 *   5. Submit button is disabled until at least one row + one mapping exists
 *   6. Click Submit fires useScimBulk with the assembled envelope
 *   7. Result viewer: shows totalOps + success count + failure count + per-op badge
 *   8. Failure rows downloadable as CSV with error.detail / error.scimType columns
 *   9. failOnErrors numeric input forwards to the envelope when > 0
 *  10. CSV with malformed quote shows a parse error and disables Submit
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { BulkTab } from './BulkTab';

// ─── Mocks ───────────────────────────────────────────────────────────

const mockMutateAsync = vi.fn();
const mockTriggerCsvDownload = vi.fn();
let mutationPending = false;

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return {
    ...actual,
    useScimBulk: () => ({
      mutate: vi.fn(),
      mutateAsync: mockMutateAsync,
      isPending: mutationPending,
    }),
  };
});

vi.mock('../utils/csv-export', async () => {
  const actual = await vi.importActual('../utils/csv-export');
  return {
    ...actual,
    triggerCsvDownload: (...args: unknown[]) => mockTriggerCsvDownload(...args),
  };
});

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <FluentProvider theme={webLightTheme}>{ui}</FluentProvider>
    </QueryClientProvider>,
  );
}

// Build a synthetic File for the drop-zone change event.
function csvFile(content: string, name = 'rows.csv'): File {
  return new File([content], name, { type: 'text/csv' });
}

const sampleCsv = `userName,displayName
alice@x.com,Alice
bob@y.com,Bob`;

describe('BulkTab (Phase M2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutationPending = false;
    mockMutateAsync.mockResolvedValue({
      status: 200,
      durationMs: 100,
      requestId: 'req-bulk',
      body: {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:BulkResponse'],
        Operations: [
          { method: 'POST', bulkId: 'row-1', status: '201', location: '/Users/u1' },
          { method: 'POST', bulkId: 'row-2', status: '201', location: '/Users/u2' },
        ],
      },
    });
  });

  // ─── 1. Top toolbar ────────────────────────────────────────────────

  it('renders mode picker + resource picker + drop-zone + Submit', () => {
    renderWithProviders(<BulkTab endpointId="ep-1" />);
    expect(screen.getByTestId('bulk-page')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-mode-picker')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-resource-picker')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-csv-input')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-submit')).toBeInTheDocument();
  });

  it('Submit is disabled when no CSV is loaded', () => {
    renderWithProviders(<BulkTab endpointId="ep-1" />);
    const btn = screen.getByTestId('bulk-submit') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  // ─── 2. CSV upload + mapping ───────────────────────────────────────

  it('uploading a CSV populates the mapping panel with one row per header', async () => {
    renderWithProviders(<BulkTab endpointId="ep-1" />);
    const input = screen.getByTestId('bulk-csv-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [csvFile(sampleCsv)] });
    fireEvent.change(input);
    await waitFor(() =>
      expect(screen.getByTestId('bulk-mapping-row-userName')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('bulk-mapping-row-displayName')).toBeInTheDocument();
  });

  // ─── 3. Preview ────────────────────────────────────────────────────

  it('preview pane shows the assembled BulkRequest envelope (first 10 ops)', async () => {
    renderWithProviders(<BulkTab endpointId="ep-1" />);
    const input = screen.getByTestId('bulk-csv-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [csvFile(sampleCsv)] });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByTestId('bulk-preview')).toBeInTheDocument());
    const preview = screen.getByTestId('bulk-preview');
    // Default mapping (matching column-name to itself) should pop the
    // mapped values into the preview.
    expect(preview.textContent).toContain('alice@x.com');
    expect(preview.textContent).toContain('Alice');
  });

  // ─── 5. Submit → useScimBulk ───────────────────────────────────────

  it('Submit fires useScimBulk with the assembled BulkRequest envelope', async () => {
    renderWithProviders(<BulkTab endpointId="ep-1" />);
    const input = screen.getByTestId('bulk-csv-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [csvFile(sampleCsv)] });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByTestId('bulk-mapping-row-userName')).toBeInTheDocument());

    const submit = screen.getByTestId('bulk-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    const env = mockMutateAsync.mock.calls[0][0] as { Operations?: Array<{ method: string; data?: { userName?: string } }> };
    expect(env.Operations).toHaveLength(2);
    expect(env.Operations?.[0].method).toBe('POST');
    expect(env.Operations?.[0].data?.userName).toBe('alice@x.com');
  });

  // ─── 6. Result viewer ──────────────────────────────────────────────

  it('Result viewer renders totals + per-op rows after a successful submit', async () => {
    renderWithProviders(<BulkTab endpointId="ep-1" />);
    const input = screen.getByTestId('bulk-csv-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [csvFile(sampleCsv)] });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByTestId('bulk-mapping-row-userName')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('bulk-submit'));
    await waitFor(() => expect(screen.getByTestId('bulk-result')).toBeInTheDocument());
    // Result envelope: 2 ops, 0 failures.
    expect(screen.getByTestId('bulk-result-success-count')).toHaveTextContent('2');
    expect(screen.getByTestId('bulk-result-failure-count')).toHaveTextContent('0');
    // Per-op rows.
    expect(screen.getByTestId('bulk-result-row-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-result-row-row-2')).toBeInTheDocument();
  });

  // ─── 7. Failure-rows-as-CSV download ───────────────────────────────

  it('Download failure rows triggers CSV with detail + scimType columns', async () => {
    mockMutateAsync.mockResolvedValueOnce({
      status: 200,
      durationMs: 100,
      requestId: 'req-bulk',
      body: {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:BulkResponse'],
        Operations: [
          { method: 'POST', bulkId: 'row-1', status: '201', location: '/Users/u1' },
          { method: 'POST', bulkId: 'row-2', status: '409', response: { scimType: 'uniqueness', detail: 'userName not unique' } },
        ],
      },
    });
    renderWithProviders(<BulkTab endpointId="ep-1" />);
    const input = screen.getByTestId('bulk-csv-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [csvFile(sampleCsv)] });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByTestId('bulk-mapping-row-userName')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('bulk-submit'));
    await waitFor(() => expect(screen.getByTestId('bulk-result')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('bulk-download-failures'));
    expect(mockTriggerCsvDownload).toHaveBeenCalledTimes(1);
    const [filename, csv] = mockTriggerCsvDownload.mock.calls[0];
    expect(filename).toMatch(/^bulk-failures-/);
    expect(csv).toContain('scimType');
    expect(csv).toContain('uniqueness');
    expect(csv).toContain('userName not unique');
    // Row-1 (success) should NOT be in the CSV.
    expect(csv).not.toContain('row-1');
    expect(csv).toContain('row-2');
  });

  // ─── 9. failOnErrors threshold ─────────────────────────────────────

  it('failOnErrors numeric input forwards to the envelope when > 0', async () => {
    renderWithProviders(<BulkTab endpointId="ep-1" />);
    const input = screen.getByTestId('bulk-csv-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [csvFile(sampleCsv)] });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByTestId('bulk-mapping-row-userName')).toBeInTheDocument());

    const failInput = screen.getByTestId('bulk-fail-on-errors') as HTMLInputElement;
    fireEvent.change(failInput, { target: { value: '5' } });
    fireEvent.click(screen.getByTestId('bulk-submit'));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    const env = mockMutateAsync.mock.calls[0][0] as { failOnErrors?: number };
    expect(env.failOnErrors).toBe(5);
  });

  // ─── 10. CSV parse error ───────────────────────────────────────────

  it('malformed CSV (unbalanced quote) shows a parse error and disables Submit', async () => {
    renderWithProviders(<BulkTab endpointId="ep-1" />);
    const input = screen.getByTestId('bulk-csv-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [csvFile('a,b\n"unclosed,2')] });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByTestId('bulk-csv-error')).toBeInTheDocument());
    expect((screen.getByTestId('bulk-submit') as HTMLButtonElement).disabled).toBe(true);
  });
});
