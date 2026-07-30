/**
 * LogsPage tests.
 *
 * Phase A3: filter state via globalLogsSearchSchema URL search params.
 * Phase D5: endpoint / status / time-range filters + DetailDrawer + R4 polish.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../test/router-test-utils';
import { globalLogsSearchSchema } from '../routes/search-schemas';

const mockUseGlobalLogs = vi.fn();
const mockUseGlobalLog = vi.fn();
const mockUseEndpoints = vi.fn();
const mockUseAuthDecisions = vi.fn((..._args: unknown[]) => ({ data: { count: 0, records: [] }, isLoading: false, error: null }));

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return {
    ...actual,
    useGlobalLogs: (...args: unknown[]) => mockUseGlobalLogs(...args),
    useGlobalLog: (...args: unknown[]) => mockUseGlobalLog(...args),
    useEndpoints: (...args: unknown[]) => mockUseEndpoints(...args),
    // U11/U12: the log row chip + the in-drawer auth section read recent
    // decisions; stub the hook so these tests need no QueryClientProvider.
    useAuthDecisions: (...args: unknown[]) => mockUseAuthDecisions(...args),
  };
});

import { LogsPage } from './LogsPage';

function wrap(ui: React.ReactElement, initialUrl = '/logs') {
  return renderWithRouter(ui, {
    initialUrl,
    routePath: '/logs',
    validateSearch: (raw) => globalLogsSearchSchema.parse(raw),
  });
}

const sampleEndpoints = {
  totalResults: 2,
  endpoints: [
    { id: 'ep-prod', name: 'production', displayName: 'Production', active: true },
    { id: 'ep-dev', name: 'dev', displayName: 'Dev', active: true },
  ],
};

const sampleLogs = {
  total: 1,
  items: [
    {
      id: 'l1',
      method: 'GET',
      url: '/scim/endpoints/ep-prod/Users',
      status: 200,
      durationMs: 5,
      createdAt: '2026-05-01T10:00:00Z',
      endpointId: 'ep-prod',
      requestId: 'req-1',
      authOutcome: 'accept',
      authMethod: 'bearer_jwt',
    },
  ],
};

describe('LogsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Sensible defaults for every test - individual tests override.
    mockUseEndpoints.mockReturnValue({ data: sampleEndpoints, isLoading: false, error: null });
    mockUseGlobalLog.mockReturnValue({ data: undefined, isLoading: false, error: null });
    mockUseAuthDecisions.mockReturnValue({ data: { count: 0, records: [] }, isLoading: false, error: null });
  });

  // ─── Existing baseline behaviors ─────────────────────────────────

  it('shows skeleton loading state (R4 - replaces Spinner)', async () => {
    mockUseGlobalLogs.mockReturnValue({ data: undefined, isLoading: true, error: null });
    wrap(<LogsPage />);
    // R4 - LoadingSkeleton replaces the legacy Spinner.
    expect(await screen.findByTestId('logs-loading-skeleton')).toBeInTheDocument();
  });

  it('renders log entries', async () => {
    mockUseGlobalLogs.mockReturnValue({ data: sampleLogs, isLoading: false, error: null });
    wrap(<LogsPage />);
    expect(await screen.findByTestId('global-logs-page')).toBeInTheDocument();
    expect(screen.getByText('GET')).toBeInTheDocument();
    // The row id testid is unique; "200" alone collides with the
    // status filter chip. Assert the row exists instead.
    expect(screen.getByTestId('logs-row-l1')).toBeInTheDocument();
  });

  it('X5/X6: a log row shows the auth-method chip + the endpoint name + a quick-open button', async () => {
    mockUseGlobalLogs.mockReturnValue({ data: sampleLogs, isLoading: false, error: null });
    wrap(<LogsPage />);
    expect(await screen.findByTestId('global-logs-page')).toBeInTheDocument();
    // X5 - the auth chip names the method (accept via bearer_jwt -> "OAuth JWT").
    const chip = screen.getByTestId('log-row-auth-l1');
    expect(chip.textContent).toContain('auth ok');
    expect(chip.textContent).toContain('OAuth JWT');
    // X6 - the endpoint NAME (resolved from endpointId) + a quick-open button.
    expect(screen.getByTestId('log-row-endpoint-l1').textContent).toContain('production');
    expect(screen.getByTestId('log-row-endpoint-open-l1')).toBeInTheDocument();
  });

  it('shows EmptyState (R4 - replaces "No logs found" text) when total=0', async () => {
    mockUseGlobalLogs.mockReturnValue({ data: { total: 0, items: [] }, isLoading: false, error: null });
    wrap(<LogsPage />);
    // R4 - EmptyState primitive.
    expect(await screen.findByTestId('logs-empty')).toBeInTheDocument();
    expect(screen.getByTestId('logs-empty-title')).toHaveTextContent(
      /No logs match these filters/i,
    );
  });

  // ─── Phase D5: new filter dimensions ─────────────────────────────

  describe('Phase D5 - filters', () => {
    it('renders the toolbar with all four filter slots', async () => {
      mockUseGlobalLogs.mockReturnValue({ data: sampleLogs, isLoading: false, error: null });
      wrap(<LogsPage />);
      expect(await screen.findByTestId('logs-toolbar')).toBeInTheDocument();
      expect(screen.getByTestId('logs-search')).toBeInTheDocument();
      expect(screen.getByTestId('logs-endpoint-select')).toBeInTheDocument();
      expect(screen.getByTestId('logs-status-chips')).toBeInTheDocument();
      expect(screen.getByTestId('logs-time-chips')).toBeInTheDocument();
    });

    it('passes endpointId from URL into useGlobalLogs', async () => {
      mockUseGlobalLogs.mockReturnValue({ data: sampleLogs, isLoading: false, error: null });
      wrap(<LogsPage />, '/logs?endpointId=ep-prod');
      await screen.findByTestId('global-logs-page');
      const args = mockUseGlobalLogs.mock.calls.at(-1)?.[0];
      expect(args).toMatchObject({ endpointId: 'ep-prod' });
    });

    it('passes status from URL into useGlobalLogs', async () => {
      mockUseGlobalLogs.mockReturnValue({ data: sampleLogs, isLoading: false, error: null });
      wrap(<LogsPage />, '/logs?status=400');
      await screen.findByTestId('global-logs-page');
      const args = mockUseGlobalLogs.mock.calls.at(-1)?.[0];
      expect(args).toMatchObject({ status: 400 });
    });

    it('derives ISO since from timeRange=24h', async () => {
      mockUseGlobalLogs.mockReturnValue({ data: sampleLogs, isLoading: false, error: null });
      wrap(<LogsPage />, '/logs?timeRange=24h');
      await screen.findByTestId('global-logs-page');
      const args = mockUseGlobalLogs.mock.calls.at(-1)?.[0];
      expect(typeof args?.since).toBe('string');
      // Within (now - 24h - 5s, now - 24h + 5s).
      const sinceMs = Date.parse(args.since as string);
      const expected = Date.now() - 24 * 60 * 60 * 1000;
      expect(Math.abs(sinceMs - expected)).toBeLessThan(5000);
    });

    it('shows reset-filters button only when filters are active', async () => {
      mockUseGlobalLogs.mockReturnValue({ data: sampleLogs, isLoading: false, error: null });
      const { unmount } = wrap(<LogsPage />, '/logs?status=400');
      expect(await screen.findByTestId('logs-reset-filters')).toBeInTheDocument();
      unmount();

      vi.clearAllMocks();
      mockUseEndpoints.mockReturnValue({ data: sampleEndpoints, isLoading: false, error: null });
      mockUseGlobalLog.mockReturnValue({ data: undefined, isLoading: false, error: null });
      mockUseGlobalLogs.mockReturnValue({ data: sampleLogs, isLoading: false, error: null });
      wrap(<LogsPage />);
      await screen.findByTestId('global-logs-page');
      expect(screen.queryByTestId('logs-reset-filters')).not.toBeInTheDocument();
    });
  });

  // ─── Phase D5: DetailDrawer ──────────────────────────────────────

  describe('Phase D5 - DetailDrawer', () => {
    it('opens DetailDrawer when ?detail=<id> is in URL', async () => {
      mockUseGlobalLogs.mockReturnValue({ data: sampleLogs, isLoading: false, error: null });
      mockUseGlobalLog.mockReturnValue({
        data: {
          id: 'l1',
          method: 'GET',
          url: '/scim/endpoints/ep-prod/Users',
          status: 200,
          durationMs: 5,
          createdAt: '2026-05-01T10:00:00Z',
          requestHeaders: { 'x-trace-id': 'abc' },
          requestBody: { foo: 'bar' },
          responseHeaders: { etag: 'W/"v1"' },
          responseBody: { Resources: [] },
        },
        isLoading: false,
        error: null,
      });
      wrap(<LogsPage />, '/logs?detail=l1');
      // Drawer renders the parsed detail object - assert at least one
      // section title is present.
      expect(await screen.findByText(/Request headers/i)).toBeInTheDocument();
      expect(screen.getByText(/Response body/i)).toBeInTheDocument();
    });

    it('shows skeleton inside drawer while detail is loading', async () => {
      mockUseGlobalLogs.mockReturnValue({ data: sampleLogs, isLoading: false, error: null });
      mockUseGlobalLog.mockReturnValue({ data: undefined, isLoading: true, error: null });
      wrap(<LogsPage />, '/logs?detail=l1');
      expect(await screen.findByTestId('logs-detail-skeleton')).toBeInTheDocument();
    });

    it('passes the detail id from URL into useGlobalLog', async () => {
      mockUseGlobalLogs.mockReturnValue({ data: sampleLogs, isLoading: false, error: null });
      mockUseGlobalLog.mockReturnValue({ data: undefined, isLoading: false, error: null });
      wrap(<LogsPage />, '/logs?detail=log-42');
      await screen.findByTestId('global-logs-page');
      const args = mockUseGlobalLog.mock.calls.at(-1) ?? [];
      expect(args[0]).toBe('log-42');
    });
  });

  // ─── Phase 3 (auth-obs) - correlationId <-> requestId bridge ─────
  describe('Phase 3 - correlation bridge', () => {
    it('passes requestId from URL into useGlobalLogs', async () => {
      mockUseGlobalLogs.mockReturnValue({ data: sampleLogs, isLoading: false, error: null });
      wrap(<LogsPage />, '/logs?requestId=corr-1');
      await screen.findByTestId('global-logs-page');
      const args = mockUseGlobalLogs.mock.calls.at(-1)?.[0];
      expect(args).toMatchObject({ requestId: 'corr-1' });
    });

    it('drawer shows the correlation id + "View auth decision" link when requestId present', async () => {
      mockUseGlobalLogs.mockReturnValue({ data: sampleLogs, isLoading: false, error: null });
      mockUseGlobalLog.mockReturnValue({
        data: {
          id: 'l1',
          method: 'GET',
          url: '/scim/endpoints/ep-prod/Users',
          status: 401,
          durationMs: 3,
          createdAt: '2026-05-01T10:00:00Z',
          requestId: 'corr-xyz',
        },
        isLoading: false,
        error: null,
      });
      wrap(<LogsPage />, '/logs?detail=l1');
      expect(await screen.findByTestId('log-detail-correlation')).toBeInTheDocument();
      expect(screen.getByTestId('log-detail-request-id')).toHaveTextContent('corr-xyz');
      // U11 - the auth decision now renders inline inside the drawer.
      expect(screen.getByTestId('log-detail-auth-section')).toBeInTheDocument();
    });

    it('U11: the in-drawer auth section renders the matching decision inline', async () => {
      mockUseGlobalLogs.mockReturnValue({ data: sampleLogs, isLoading: false, error: null });
      mockUseGlobalLog.mockReturnValue({
        data: {
          id: 'l1',
          method: 'GET',
          url: '/scim/endpoints/ep-prod/Users',
          status: 401,
          durationMs: 3,
          createdAt: '2026-05-01T10:00:00Z',
          requestId: 'corr-xyz',
        },
        isLoading: false,
        error: null,
      });
      mockUseAuthDecisions.mockReturnValue({
        data: {
          count: 1,
          records: [
            {
              id: 'adr-1',
              outcome: 'reject',
              reasonCode: 'wif_audience_mismatch',
              method: 'wif',
              plane: 'token-mint',
              correlationId: 'corr-xyz',
              recordedAt: '2026-05-01T10:00:00Z',
              checks: [{ id: 'audience_match', status: 'fail', expected: 'api://app', received: 'api://wrong' }],
            },
          ],
        },
        isLoading: false,
        error: null,
      } as never);
      wrap(<LogsPage />, '/logs?detail=l1');
      // The inline section shows the matched decision's reason + check diff.
      expect(await screen.findByTestId('log-detail-auth-section-record')).toBeInTheDocument();
      expect(screen.getByTestId('auth-decision-check-audience_match')).toBeInTheDocument();
    });

    it('U12: a request-log row shows an auth-outcome chip when a decision matches', async () => {
      mockUseGlobalLogs.mockReturnValue({
        data: {
          total: 1,
          items: [
            { id: 'l1', method: 'GET', url: '/scim/endpoints/ep-prod/Users', status: 401, durationMs: 3, createdAt: '2026-05-01T10:00:00Z', requestId: 'corr-xyz' },
          ],
        },
        isLoading: false,
        error: null,
      });
      mockUseAuthDecisions.mockReturnValue({
        data: {
          count: 1,
          records: [
            { id: 'adr-1', outcome: 'reject', reasonCode: 'wif_audience_mismatch', method: 'wif', plane: 'token-mint', correlationId: 'corr-xyz', recordedAt: '2026-05-01T10:00:00Z', checks: [] },
          ],
        },
        isLoading: false,
        error: null,
      } as never);
      wrap(<LogsPage />, '/logs');
      const chip = await screen.findByTestId('log-row-auth-l1');
      expect(chip.textContent).toContain('wif_audience_mismatch');
    });

    it('does not render the correlation section when the log has no requestId', async () => {
      mockUseGlobalLogs.mockReturnValue({ data: sampleLogs, isLoading: false, error: null });
      mockUseGlobalLog.mockReturnValue({
        data: {
          id: 'l1',
          method: 'GET',
          url: '/scim/endpoints/ep-prod/Users',
          status: 200,
          durationMs: 5,
          createdAt: '2026-05-01T10:00:00Z',
        },
        isLoading: false,
        error: null,
      });
      wrap(<LogsPage />, '/logs?detail=l1');
      await screen.findByTestId('global-logs-page');
      expect(screen.queryByTestId('log-detail-correlation')).not.toBeInTheDocument();
    });
  });

  // ─── V10/V11/V12 - durable auth summary persisted ON the row ──────
  describe('V10/V11/V12 - durable auth summary on the row', () => {
    it('V10/V12: row chip reads the PERSISTED authOutcome even with NO live auth-decision record', async () => {
      // The live auth-decision query returns nothing (as it would after the
      // short-TTL store expires) - the chip must still render from the row.
      mockUseAuthDecisions.mockReturnValue({ data: { count: 0, records: [] }, isLoading: false, error: null });
      mockUseGlobalLogs.mockReturnValue({
        data: {
          total: 1,
          items: [
            {
              id: 'l1',
              method: 'POST',
              url: '/scim/endpoints/ep-prod/Users',
              status: 401,
              durationMs: 3,
              createdAt: '2026-05-01T10:00:00Z',
              requestId: 'corr-old',
              authOutcome: 'reject',
              authMethod: 'wif',
              authReason: 'wif_issuer_mismatch',
            },
          ],
        },
        isLoading: false,
        error: null,
      });
      wrap(<LogsPage />, '/logs');
      const chip = await screen.findByTestId('log-row-auth-l1');
      expect(chip.textContent).toContain('wif_issuer_mismatch');
    });

    it('V10: an accepted row renders the "auth ok" chip from the persisted field', async () => {
      mockUseAuthDecisions.mockReturnValue({ data: { count: 0, records: [] }, isLoading: false, error: null });
      mockUseGlobalLogs.mockReturnValue({
        data: {
          total: 1,
          items: [
            {
              id: 'l1',
              method: 'GET',
              url: '/scim/endpoints/ep-prod/Users',
              status: 200,
              durationMs: 5,
              createdAt: '2026-05-01T10:00:00Z',
              authOutcome: 'accept',
              authMethod: 'oauth_client',
            },
          ],
        },
        isLoading: false,
        error: null,
      });
      wrap(<LogsPage />, '/logs');
      const chip = await screen.findByTestId('log-row-auth-l1');
      expect(chip.textContent).toContain('auth ok');
    });

    it('W1: the in-drawer auth section renders from the PERSISTED decision with an empty store', async () => {
      mockUseGlobalLogs.mockReturnValue({ data: sampleLogs, isLoading: false, error: null });
      // The short-TTL store is EMPTY - the persisted authDecision on the row is
      // the only source, and the diff must still render.
      mockUseAuthDecisions.mockReturnValue({ data: { count: 0, records: [] }, isLoading: false, error: null });
      mockUseGlobalLog.mockReturnValue({
        data: {
          id: 'l1',
          method: 'GET',
          url: '/scim/endpoints/ep-prod/Users',
          status: 200,
          durationMs: 5,
          createdAt: '2026-05-01T10:00:00Z',
          requestId: 'corr-persisted',
          authOutcome: 'accept',
          authMethod: 'bearer_jwt',
          authDecision: {
            plane: 'resource',
            method: 'bearer_jwt',
            outcome: 'accept',
            checks: [
              { id: 'oauth_jwt', status: 'pass', expected: 'ep-prod', received: 'ep-prod' },
            ],
          },
        },
        isLoading: false,
        error: null,
      });
      wrap(<LogsPage />, '/logs?detail=l1');
      expect(await screen.findByTestId('log-detail-auth-section-record')).toBeInTheDocument();
      expect(screen.getByTestId('auth-decision-check-oauth_jwt')).toBeInTheDocument();
      expect(screen.queryByTestId('log-detail-auth-section-empty')).not.toBeInTheDocument();
    });

    it('V11: drawer shows the durable "Authenticated via" summary from persisted fields', async () => {
      mockUseGlobalLogs.mockReturnValue({ data: sampleLogs, isLoading: false, error: null });
      mockUseGlobalLog.mockReturnValue({
        data: {
          id: 'l1',
          method: 'POST',
          url: '/scim/endpoints/ep-prod/Users',
          status: 201,
          durationMs: 6,
          createdAt: '2026-05-01T10:00:00Z',
          requestId: 'corr-xyz',
          authOutcome: 'accept',
          authMethod: 'wif',
          authCredentialId: 'trust-abc',
          authReason: 'ok',
        },
        isLoading: false,
        error: null,
      });
      wrap(<LogsPage />, '/logs?detail=l1');
      const summary = await screen.findByTestId('log-detail-auth-summary');
      expect(summary.textContent).toContain('Authenticated via');
      expect(summary.textContent).toContain('wif');
      expect(summary.textContent).toContain('trust-abc');
    });
  });

  // ─── Phase P1 - CopyableField primitives on row + drawer ─────────
  describe('Phase P1 - CopyableField primitives', () => {
    it('renders row URL column via CopyableField with stable testid + copy button', async () => {
      mockUseGlobalLogs.mockReturnValue({ data: sampleLogs, isLoading: false, error: null });
      wrap(<LogsPage />);
      const cell = await screen.findByTestId('log-row-url-l1');
      expect(cell).toBeInTheDocument();
      expect(screen.getByTestId('log-row-url-l1-copy-button')).toBeInTheDocument();
    });

    it('renders copy buttons in drawer for request body / response headers / response body', async () => {
      mockUseGlobalLogs.mockReturnValue({ data: sampleLogs, isLoading: false, error: null });
      mockUseGlobalLog.mockReturnValue({
        data: {
          id: 'l1',
          method: 'GET',
          url: '/scim/endpoints/ep-prod/Users',
          status: 200,
          durationMs: 5,
          createdAt: '2026-05-01T10:00:00Z',
          requestHeaders: { 'x-trace-id': 'abc' },
          requestBody: { foo: 'bar' },
          responseHeaders: { etag: 'W/"v1"' },
          responseBody: { Resources: [] },
        },
        isLoading: false,
        error: null,
      });
      wrap(<LogsPage />, '/logs?detail=l1');
      expect(await screen.findByTestId('log-detail-url-copy-button')).toBeInTheDocument();
      expect(screen.getByTestId('log-detail-request-body-copy-button')).toBeInTheDocument();
      expect(screen.getByTestId('log-detail-response-headers-copy-button')).toBeInTheDocument();
      expect(screen.getByTestId('log-detail-response-body-copy-button')).toBeInTheDocument();
    });
  });
});
