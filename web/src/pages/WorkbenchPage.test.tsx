/**
 * WorkbenchPage tests (Phase M1).
 *
 * Asserts:
 *   1. Page renders with Method picker + Path input + endpoint picker
 *   2. Body editor visible only for POST/PUT/PATCH
 *   3. Send button disabled when path is empty; enabled with a path
 *   4. Click Send fires useScimRequest with the assembled args
 *   5. Response viewer shows status badge + duration + body JSON
 *   6. History list renders one row per appendHistory call
 *   7. Copy as curl emits a curl line containing the method + path
 *   8. Copy as TypeScript emits a fetch() snippet
 *   9. Endpoint picker selection prepends the path to scim/endpoints/:id
 *   10. Read-from-URL: ?prefill=<urlencoded-json> seeds method/path/body
 *       (used by L5 "Open in Workbench" button)
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { WorkbenchPage } from './WorkbenchPage';

// ─── Mocks ───────────────────────────────────────────────────────────

const mockUseEndpoints = vi.fn();
const mockMutateAsync = vi.fn();
let mutationPending = false;

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return {
    ...actual,
    useEndpoints: () => mockUseEndpoints(),
    useScimRequest: () => ({
      mutate: vi.fn(),
      mutateAsync: mockMutateAsync,
      isPending: mutationPending,
    }),
  };
});

// useSearch returns the URL search params - mock per-test.
const mockUseSearch = vi.fn(() => ({}));
vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-router')>(
    '@tanstack/react-router',
  );
  return {
    ...actual,
    useSearch: () => mockUseSearch(),
    useNavigate: () => vi.fn(),
  };
});

const sampleEndpoints = {
  totalResults: 2,
  endpoints: [
    { id: 'ep-1', name: 'prod', displayName: 'Production', active: true },
    { id: 'ep-2', name: 'staging', displayName: 'Staging', active: true },
  ],
};

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

describe('WorkbenchPage (Phase M1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutationPending = false;
    localStorage.clear();
    mockUseEndpoints.mockReturnValue({ data: sampleEndpoints, isLoading: false, isError: false, error: null });
    mockMutateAsync.mockResolvedValue({
      status: 200,
      durationMs: 42,
      requestId: 'req-x',
      body: { ok: true },
    });
    mockUseSearch.mockReturnValue({});
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(() => Promise.resolve()) },
      writable: true,
      configurable: true,
    });
  });

  // ─── 1. Top toolbar renders ────────────────────────────────────────

  it('renders Method picker + Path input + endpoint picker + Send button', () => {
    renderWithProviders(<WorkbenchPage />);
    expect(screen.getByTestId('workbench-page')).toBeInTheDocument();
    expect(screen.getByTestId('workbench-method')).toBeInTheDocument();
    expect(screen.getByTestId('workbench-path')).toBeInTheDocument();
    expect(screen.getByTestId('workbench-endpoint-picker')).toBeInTheDocument();
    expect(screen.getByTestId('workbench-send')).toBeInTheDocument();
  });

  // ─── 2. Body editor visibility ─────────────────────────────────────

  it('hides the body editor when method is GET', () => {
    renderWithProviders(<WorkbenchPage />);
    expect(screen.queryByTestId('workbench-body')).not.toBeInTheDocument();
  });

  it('shows the body editor when method is POST', () => {
    renderWithProviders(<WorkbenchPage />);
    fireEvent.change(screen.getByTestId('workbench-method'), { target: { value: 'POST' } });
    expect(screen.getByTestId('workbench-body')).toBeInTheDocument();
  });

  // ─── 3. Send button gating ─────────────────────────────────────────

  it('Send is disabled when path is empty', () => {
    renderWithProviders(<WorkbenchPage />);
    const send = screen.getByTestId('workbench-send') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
  });

  it('Send is enabled once a path is typed', () => {
    renderWithProviders(<WorkbenchPage />);
    fireEvent.change(screen.getByTestId('workbench-path'), {
      target: { value: '/scim/endpoints/ep-1/Users' },
    });
    const send = screen.getByTestId('workbench-send') as HTMLButtonElement;
    expect(send.disabled).toBe(false);
  });

  // ─── 4. Send fires useScimRequest ──────────────────────────────────

  it('clicking Send calls useScimRequest with the assembled args', async () => {
    renderWithProviders(<WorkbenchPage />);
    fireEvent.change(screen.getByTestId('workbench-path'), {
      target: { value: '/scim/endpoints/ep-1/Users' },
    });
    fireEvent.click(screen.getByTestId('workbench-send'));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    const args = mockMutateAsync.mock.calls[0][0] as { method: string; path: string };
    expect(args.method).toBe('GET');
    expect(args.path).toBe('/scim/endpoints/ep-1/Users');
  });

  it('POST with a JSON body forwards the parsed body', async () => {
    renderWithProviders(<WorkbenchPage />);
    fireEvent.change(screen.getByTestId('workbench-method'), { target: { value: 'POST' } });
    fireEvent.change(screen.getByTestId('workbench-path'), {
      target: { value: '/scim/endpoints/ep-1/Users' },
    });
    fireEvent.change(screen.getByTestId('workbench-body'), {
      target: { value: '{"userName":"new@x.com"}' },
    });
    fireEvent.click(screen.getByTestId('workbench-send'));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    const args = mockMutateAsync.mock.calls[0][0] as { body: unknown };
    expect(args.body).toEqual({ userName: 'new@x.com' });
  });

  // ─── 5. Response viewer ────────────────────────────────────────────

  it('shows status + duration + body once a response arrives', async () => {
    renderWithProviders(<WorkbenchPage />);
    fireEvent.change(screen.getByTestId('workbench-path'), {
      target: { value: '/scim/endpoints/ep-1/Users' },
    });
    fireEvent.click(screen.getByTestId('workbench-send'));
    await waitFor(() => expect(screen.getByTestId('workbench-response')).toBeInTheDocument());
    expect(screen.getByTestId('workbench-response-status')).toHaveTextContent('200');
    expect(screen.getByTestId('workbench-response-duration')).toHaveTextContent('42');
    // Body shown as pretty-printed JSON.
    const body = screen.getByTestId('workbench-response-body-pre');
    expect(body.textContent).toContain('"ok"');
  });

  // ─── 6. History ────────────────────────────────────────────────────

  it('appends a new history row after a successful Send', async () => {
    renderWithProviders(<WorkbenchPage />);
    fireEvent.change(screen.getByTestId('workbench-path'), {
      target: { value: '/scim/endpoints/ep-1/Users' },
    });
    fireEvent.click(screen.getByTestId('workbench-send'));
    await waitFor(() => expect(screen.getByTestId('workbench-history')).toBeInTheDocument());
    const rows = screen.getAllByTestId(/^workbench-history-row-/);
    expect(rows.length).toBe(1);
  });

  it('Save as live-test button on a history row copies a paste-ready PowerShell snippet (Phase M2)', async () => {
    renderWithProviders(<WorkbenchPage />);
    fireEvent.change(screen.getByTestId('workbench-path'), {
      target: { value: '/scim/endpoints/ep-1/Users' },
    });
    fireEvent.click(screen.getByTestId('workbench-send'));
    await waitFor(() => expect(screen.getByTestId('workbench-history')).toBeInTheDocument());
    const saveBtn = screen.getAllByTestId(/^workbench-save-as-live-test-/)[0];
    fireEvent.click(saveBtn);
    expect((navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    const last = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[
      (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls.length - 1
    ][0] as string;
    expect(last).toMatch(/Invoke-WebRequest/);
    expect(last).toContain('/scim/endpoints/ep-1/Users');
    expect(last).toMatch(/Test-Result\s+-Success/);
  });

  // ─── 7-8. Copy as curl + Copy as TypeScript ────────────────────────

  it('Copy as curl writes a curl line containing the method + path', async () => {
    renderWithProviders(<WorkbenchPage />);
    fireEvent.change(screen.getByTestId('workbench-path'), {
      target: { value: '/scim/endpoints/ep-1/Users' },
    });
    fireEvent.click(screen.getByTestId('workbench-copy-curl'));
    expect((navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    const arg = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(arg).toMatch(/^curl /);
    expect(arg).toContain("-X 'GET'");
    expect(arg).toContain('/scim/endpoints/ep-1/Users');
  });

  it('Copy as TypeScript writes a fetch() snippet', () => {
    renderWithProviders(<WorkbenchPage />);
    fireEvent.change(screen.getByTestId('workbench-path'), {
      target: { value: '/scim/endpoints/ep-1/Users' },
    });
    fireEvent.click(screen.getByTestId('workbench-copy-ts'));
    const arg = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(arg).toContain('fetch(');
    expect(arg).toContain('/scim/endpoints/ep-1/Users');
    // The snippet uses JSON-style "method": "GET" (double-quoted) since
    // it's serialized via JSON.stringify; both forms are paste-runnable.
    expect(arg).toMatch(/"method":\s*"GET"/);
  });

  // ─── 9. Endpoint picker convenience ────────────────────────────────

  it('selecting an endpoint pre-fills the path with the per-endpoint Users list', () => {
    renderWithProviders(<WorkbenchPage />);
    fireEvent.change(screen.getByTestId('workbench-endpoint-picker'), { target: { value: 'ep-1' } });
    const path = screen.getByTestId('workbench-path') as HTMLInputElement;
    expect(path.value).toBe('/scim/endpoints/ep-1/Users');
  });

  // ─── 10. URL prefill (used by L5 Open in Workbench) ────────────────

  it('reads ?prefill from URL search to seed method/path/body', async () => {
    mockUseSearch.mockReturnValue({
      prefill: encodeURIComponent(JSON.stringify({
        method: 'POST',
        path: '/scim/endpoints/ep-1/Users',
        body: { schemas: ['urn:...'], userName: 'pre@x.com' },
      })),
    });
    renderWithProviders(<WorkbenchPage />);
    const method = screen.getByTestId('workbench-method') as HTMLSelectElement;
    const path = screen.getByTestId('workbench-path') as HTMLInputElement;
    expect(method.value).toBe('POST');
    expect(path.value).toBe('/scim/endpoints/ep-1/Users');
    // Body editor should be visible (POST) and contain the JSON.
    await waitFor(() => expect(screen.getByTestId('workbench-body')).toBeInTheDocument());
    const body = screen.getByTestId('workbench-body') as HTMLTextAreaElement;
    expect(body.value).toContain('"userName"');
    expect(body.value).toContain('"pre@x.com"');
  });

  // ─── Phase P1 - CopyableField primitives in response + history ────
  describe('Phase P1 - CopyableField primitives', () => {
    it('renders copy button next to requestId in the response header', async () => {
      renderWithProviders(<WorkbenchPage />);
      fireEvent.change(screen.getByTestId('workbench-path'), {
        target: { value: '/scim/endpoints/ep-1/Users' },
      });
      fireEvent.click(screen.getByTestId('workbench-send'));
      await waitFor(() => expect(screen.getByTestId('workbench-response')).toBeInTheDocument());
      expect(screen.getByTestId('workbench-response-request-id-copy-button')).toBeInTheDocument();
    });

    it('renders copy button for the response body', async () => {
      renderWithProviders(<WorkbenchPage />);
      fireEvent.change(screen.getByTestId('workbench-path'), {
        target: { value: '/scim/endpoints/ep-1/Users' },
      });
      fireEvent.click(screen.getByTestId('workbench-send'));
      await waitFor(() => expect(screen.getByTestId('workbench-response')).toBeInTheDocument());
      expect(screen.getByTestId('workbench-response-body-copy-button')).toBeInTheDocument();
    });

    it('renders copy button on each history row path cell', async () => {
      renderWithProviders(<WorkbenchPage />);
      fireEvent.change(screen.getByTestId('workbench-path'), {
        target: { value: '/scim/endpoints/ep-1/Users' },
      });
      fireEvent.click(screen.getByTestId('workbench-send'));
      await waitFor(() => expect(screen.getByTestId('workbench-history')).toBeInTheDocument());
      const rows = screen.getAllByTestId(/^workbench-history-row-/);
      expect(rows.length).toBe(1);
      const rowId = rows[0].getAttribute('data-testid')?.replace('workbench-history-row-', '');
      expect(rowId).toBeTruthy();
      expect(screen.getByTestId(`workbench-history-path-${rowId}-copy-button`)).toBeInTheDocument();
    });
  });
});
