import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { AuthDiagnosticsPanel } from './AuthDiagnosticsPanel';
import type { AuthDecisionRecord, AuthDecisionsResponse } from '@scim/types/auth-decision.types';

const mockUseAuthDecisions = vi.fn();
const mockNavigate = vi.fn();

vi.mock('../../api/queries', () => ({
  useAuthDecisions: (...args: unknown[]) => mockUseAuthDecisions(...args),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

const renderWithFluent = (ui: React.ReactElement): ReturnType<typeof render> =>
  render(<FluentProvider theme={webLightTheme}>{ui}</FluentProvider>);

/** Expand a decision accordion row (the toggle is a <button> inside the header). */
function expandRow(testId: string): void {
  const header = screen.getByTestId(testId);
  const button = header.closest('button') ?? header.querySelector('button');
  fireEvent.click(button ?? header);
}

function rejectRecord(over: Partial<AuthDecisionRecord> = {}): AuthDecisionRecord {
  return {
    id: 'adr_1',
    recordedAt: new Date().toISOString(),
    plane: 'token-mint',
    method: 'wif',
    outcome: 'reject',
    reasonCode: 'wif_audience_mismatch',
    endpointId: 'ep-1',
    correlationId: 'req-abc',
    checks: [
      { id: 'jwks_signature', status: 'pass' },
      { id: 'audience_match', status: 'fail', expected: 'api://a', received: 'api://b' },
    ],
    decodedClaims: { iss: 'issuer-a', aud: 'api://b' },
    ...over,
  };
}

function response(records: AuthDecisionRecord[]): AuthDecisionsResponse {
  return { count: records.length, records };
}

describe('AuthDiagnosticsPanel (WI-D6)', () => {
  beforeEach(() => {
    mockUseAuthDecisions.mockReset();
    mockNavigate.mockReset();
  });

  it('renders a loading skeleton while fetching', () => {
    mockUseAuthDecisions.mockReturnValue({ data: undefined, isLoading: true, error: null });
    renderWithFluent(<AuthDiagnosticsPanel endpointId="ep-1" />);
    expect(screen.getByTestId('auth-diagnostics-panel')).toBeInTheDocument();
  });

  it('renders an empty state when there are no decisions', () => {
    mockUseAuthDecisions.mockReturnValue({ data: response([]), isLoading: false, error: null });
    renderWithFluent(<AuthDiagnosticsPanel endpointId="ep-1" />);
    expect(screen.getByTestId('auth-diagnostics-panel-empty')).toBeInTheDocument();
  });

  it('renders an error state when the query fails', () => {
    mockUseAuthDecisions.mockReturnValue({ data: undefined, isLoading: false, error: new Error('boom') });
    renderWithFluent(<AuthDiagnosticsPanel endpointId="ep-1" />);
    expect(screen.getByTestId('auth-diagnostics-panel-error')).toBeInTheDocument();
  });

  it('lists decisions with an outcome badge + reason code', () => {
    mockUseAuthDecisions.mockReturnValue({ data: response([rejectRecord()]), isLoading: false, error: null });
    renderWithFluent(<AuthDiagnosticsPanel endpointId="ep-1" />);
    expect(screen.getByTestId('auth-decision-row-adr_1')).toBeInTheDocument();
    expect(screen.getByTestId('auth-decision-outcome-adr_1')).toHaveTextContent('reject');
  });

  it('shows the expected-vs-received check diff when expanded', () => {
    mockUseAuthDecisions.mockReturnValue({ data: response([rejectRecord()]), isLoading: false, error: null });
    renderWithFluent(<AuthDiagnosticsPanel endpointId="ep-1" />);
    // Accordion header toggles the panel.
    expandRow('auth-decision-row-adr_1');
    expect(screen.getByTestId('auth-decision-detail-adr_1')).toBeInTheDocument();
    const failedCheck = screen.getByTestId('auth-decision-check-audience_match');
    expect(failedCheck).toHaveTextContent('api://a');
    expect(failedCheck).toHaveTextContent('api://b');
  });

  it('Phase 1: a PASSING check renders its populated received value (not "-")', () => {
    const acceptRecord: AuthDecisionRecord = {
      id: 'adr_ok',
      recordedAt: new Date().toISOString(),
      plane: 'token-mint',
      method: 'wif',
      outcome: 'accept',
      endpointId: 'ep-1',
      correlationId: 'req-ok',
      checks: [
        { id: 'issuer_match', status: 'pass', expected: 'https://idp/v2.0', received: 'https://idp/v2.0' },
        { id: 'audience_match', status: 'pass', expected: 'api://app', received: 'api://app' },
      ],
    };
    mockUseAuthDecisions.mockReturnValue({ data: response([acceptRecord]), isLoading: false, error: null });
    renderWithFluent(<AuthDiagnosticsPanel endpointId="ep-1" />);
    expandRow('auth-decision-row-adr_ok');
    const issuer = screen.getByTestId('auth-decision-check-issuer_match');
    // Both expected AND received are shown for the passing check.
    expect(issuer).toHaveTextContent('https://idp/v2.0');
    // The received cell is the matched value, not the "-" placeholder.
    expect(issuer.textContent).not.toMatch(/-\s*$/);
  });

  it('shows a remediation hint + fix link for a known reason code', () => {
    mockUseAuthDecisions.mockReturnValue({ data: response([rejectRecord()]), isLoading: false, error: null });
    renderWithFluent(<AuthDiagnosticsPanel endpointId="ep-1" />);
    expandRow('auth-decision-row-adr_1');
    expect(screen.getByTestId('auth-decision-remediation-adr_1')).toHaveTextContent('wif_audience_mismatch');
    fireEvent.click(screen.getByTestId('auth-decision-fix-adr_1'));
    // R8 cross-link routes to the endpoint's Credentials tab for a WIF reason.
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: '/endpoints/$endpointId/credentials', params: { endpointId: 'ep-1' } }),
    );
  });

  it('a jwks reason routes the fix link to global Settings', () => {
    mockUseAuthDecisions.mockReturnValue({
      data: response([rejectRecord({ id: 'adr_2', reasonCode: 'jwks_host_not_allowlisted' })]),
      isLoading: false,
      error: null,
    });
    renderWithFluent(<AuthDiagnosticsPanel endpointId="ep-1" />);
    expandRow('auth-decision-row-adr_2');
    fireEvent.click(screen.getByTestId('auth-decision-fix-adr_2'));
    expect(mockNavigate).toHaveBeenCalledWith(expect.objectContaining({ to: '/settings' }));
  });

  it('renders the full non-secret record as a CopyableJsonBlock', () => {
    mockUseAuthDecisions.mockReturnValue({ data: response([rejectRecord()]), isLoading: false, error: null });
    renderWithFluent(<AuthDiagnosticsPanel endpointId="ep-1" />);
    expandRow('auth-decision-row-adr_1');
    expect(screen.getByTestId('auth-decision-json-adr_1')).toBeInTheDocument();
  });

  it('passes the endpointId scope through to the query hook', () => {
    mockUseAuthDecisions.mockReturnValue({ data: response([]), isLoading: false, error: null });
    renderWithFluent(<AuthDiagnosticsPanel endpointId="ep-xyz" limit={10} />);
    expect(mockUseAuthDecisions).toHaveBeenCalledWith({ endpointId: 'ep-xyz', limit: 10 });
  });

  it('global scope omits the endpointId', () => {
    mockUseAuthDecisions.mockReturnValue({ data: response([]), isLoading: false, error: null });
    renderWithFluent(<AuthDiagnosticsPanel />);
    expect(mockUseAuthDecisions).toHaveBeenCalledWith({ endpointId: undefined, limit: 25 });
  });
});
