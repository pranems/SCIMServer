/**
 * AuthDiagnosticsPanel (WI-D6) - the centerpiece auth-diagnostics surface.
 *
 * Renders the recent Auth Decision Records (WI-D5) for an endpoint (or
 * globally) as a readable list, each expandable to an expected-vs-received
 * per-claim/per-check diff derived from the WI-D3 trace. A reject row shows the
 * catalog reason code + a human remediation hint (WI-D2) and an R8 cross-link
 * to the fix surface (Settings > JWKS host allowlist, Credentials, etc.).
 *
 * The same panel is embedded on three surfaces (D6):
 *   - the Connect tab (per-endpoint scope),
 *   - the endpoint Logs tab (per-endpoint scope),
 *   - the admin Logs page (global scope).
 *
 * All values shown are NON-SECRET (the store only holds sanitized trace
 * fields). Uses the R9 copy primitives (CopyableJsonBlock, CopyableField).
 */
import * as React from 'react';
import {
  makeStyles,
  tokens,
  Text,
  Subtitle2,
  Caption1,
  Badge,
  Accordion,
  AccordionItem,
  AccordionHeader,
  AccordionPanel,
  Link,
} from '@fluentui/react-components';
import { useNavigate } from '@tanstack/react-router';
import { useAuthDecisions } from '../../api/queries';
import { CopyableField, CopyableJsonBlock } from './index';
import { EmptyState } from './EmptyState';
import { LoadingSkeleton } from './LoadingSkeleton';
import type {
  AuthCheck,
  AuthDecisionRecord,
} from '@scim/types/auth-decision.types';

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 },
  header: { display: 'flex', flexDirection: 'column', gap: '2px' },
  hint: { color: tokens.colorNeutralForeground3 },
  rowHeader: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  detail: { display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 },
  checkTable: { display: 'flex', flexDirection: 'column', gap: '4px' },
  checkRow: {
    display: 'grid',
    gridTemplateColumns: '20px 1fr 1fr 1fr',
    gap: '8px',
    alignItems: 'start',
    padding: '4px 0',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  checkHead: { fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground3 },
  remediation: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '8px',
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
  },
  mono: { fontFamily: 'Consolas, "Courier New", monospace', wordBreak: 'break-all' },
});

/** Client-side remediation hints for the common reason codes (WI-D8 expands this). */
const REASON_REMEDIATION: Record<string, { text: string; fix?: 'jwks' | 'credentials' | 'settings' }> = {
  jwks_host_not_allowlisted: {
    text: 'Add or edit the JWKS host in Settings > JWKS host allowlist.',
    fix: 'jwks',
  },
  wif_issuer_mismatch: { text: 'Align the trust expectedIssuer with the IdP iss.', fix: 'credentials' },
  wif_audience_mismatch: { text: 'Align the trust expectedAudience with the IdP aud.', fix: 'credentials' },
  wif_tenant_mismatch: { text: 'Align the trust allowedTenantId with the IdP tid.', fix: 'credentials' },
  wif_subject_mismatch: { text: 'Align the trust expectedSubject with the service-principal object id.', fix: 'credentials' },
  wif_no_trust_configured: { text: 'Create a WIF credential and enable WifCredentialsEnabled.', fix: 'credentials' },
  wif_no_trust_accepted: { text: 'Check which configured trust should match the assertion issuer.', fix: 'credentials' },
  assertion_expired: { text: 'Check clock skew; request a fresh assertion.' },
  assertion_signature_invalid: { text: 'Confirm the IdP signing key is published at the trust jwksUri.', fix: 'credentials' },
  oauth_client_auth_failed: { text: 'Verify the client_id and client_secret; rotate if needed.', fix: 'credentials' },
};

function outcomeBadge(record: AuthDecisionRecord): React.ReactElement {
  return record.outcome === 'accept' ? (
    <Badge appearance="filled" color="success" data-testid={`auth-decision-outcome-${record.id}`}>
      accept
    </Badge>
  ) : (
    <Badge appearance="filled" color="danger" data-testid={`auth-decision-outcome-${record.id}`}>
      reject
    </Badge>
  );
}

const CheckRow: React.FC<{ check: AuthCheck }> = ({ check }) => {
  const classes = useStyles();
  const glyph = check.status === 'pass' ? 'PASS' : check.status === 'fail' ? 'FAIL' : 'SKIP';
  return (
    <div className={classes.checkRow} data-testid={`auth-decision-check-${check.id}`}>
      <Caption1>{glyph}</Caption1>
      <Text className={classes.mono}>{check.id}</Text>
      <Caption1 className={classes.mono}>{check.expected ?? '-'}</Caption1>
      <Caption1 className={classes.mono}>{check.received ?? '-'}</Caption1>
    </div>
  );
};

const DecisionDetail: React.FC<{ record: AuthDecisionRecord; endpointId?: string }> = ({
  record,
  endpointId,
}) => {
  const classes = useStyles();
  const navigate = useNavigate();
  const remediation = record.reasonCode ? REASON_REMEDIATION[record.reasonCode] : undefined;

  const goFix = React.useCallback(() => {
    if (!remediation?.fix) return;
    if (remediation.fix === 'jwks') {
      void navigate({ to: '/settings' });
    } else if (endpointId) {
      void navigate({
        to: remediation.fix === 'credentials'
          ? '/endpoints/$endpointId/connect'
          : '/endpoints/$endpointId/settings',
        params: { endpointId },
      });
    }
  }, [navigate, remediation, endpointId]);

  // Phase 3 (auth-obs) - deep-link from an auth decision to the request
  // log that produced it, using the shared X-Request-Id correlation id.
  const viewRequestLog = React.useCallback(() => {
    if (!record.correlationId) return;
    void navigate({
      to: '/logs',
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        requestId: record.correlationId,
        detail: undefined,
      }),
    });
  }, [navigate, record.correlationId]);

  const allChecks: AuthCheck[] = [
    ...record.checks,
    ...(record.subTraces ?? []).flatMap((s) => s.checks),
  ];

  return (
    <div className={classes.detail} data-testid={`auth-decision-detail-${record.id}`}>
      {record.reasonCode && (
        <div className={classes.remediation} data-testid={`auth-decision-remediation-${record.id}`}>
          <div className={classes.rowHeader}>
            <Text weight="semibold" className={classes.mono}>
              {record.reasonCode}
            </Text>
          </div>
          {remediation && <Caption1>{remediation.text}</Caption1>}
          {remediation?.fix && (
            <Link data-testid={`auth-decision-fix-${record.id}`} onClick={goFix}>
              {remediation.fix === 'jwks'
                ? 'Fix in Settings > JWKS host allowlist'
                : remediation.fix === 'credentials'
                  ? 'Fix in Connect'
                  : 'Fix in Settings'}
            </Link>
          )}
        </div>
      )}

      {allChecks.length > 0 && (
        <div className={classes.checkTable} data-testid={`auth-decision-checks-${record.id}`}>
          <div className={classes.checkRow}>
            <Caption1 className={classes.checkHead}>{''}</Caption1>
            <Caption1 className={classes.checkHead}>check</Caption1>
            <Caption1 className={classes.checkHead}>expected</Caption1>
            <Caption1 className={classes.checkHead}>received</Caption1>
          </div>
          {allChecks.map((c, i) => (
            <CheckRow key={`${c.id}-${i}`} check={c} />
          ))}
        </div>
      )}

      {record.correlationId && (
        <div className={classes.rowHeader}>
          <Caption1 className={classes.hint}>Correlation id</Caption1>
          <CopyableField
            value={record.correlationId}
            monospace
            data-testid={`auth-decision-correlation-${record.id}`}
          />
          <Link
            data-testid={`auth-decision-view-request-log-${record.id}`}
            onClick={viewRequestLog}
          >
            View request log
          </Link>
        </div>
      )}

      <CopyableJsonBlock
        label="Full decision record"
        value={record}
        data-testid={`auth-decision-json-${record.id}`}
      />
    </div>
  );
};

export interface AuthDiagnosticsPanelProps {
  /** Per-endpoint scope when set; omit for the global admin scope. */
  endpointId?: string;
  /** Optional max rows (default 25). */
  limit?: number;
  /**
   * Phase 3 (auth-obs) - when set, filter the list to the decision(s)
   * whose correlationId matches (the X-Request-Id of a request log the
   * operator drilled in from). The matching rows are auto-expanded.
   */
  focusCorrelationId?: string;
  /** Called when the operator clears the focus filter. */
  onClearFocus?: () => void;
  'data-testid'?: string;
}

/**
 * U11 - a compact, single-decision auth view for embedding INSIDE a request
 * log's DetailDrawer. Given the log's `correlationId` (its X-Request-Id), it
 * finds the matching recent auth decision and renders its outcome + the
 * expected-vs-received check diff + reason + remediation inline, so the auth
 * step of a request is part of the request's own detail (not a sibling panel).
 */
export const AuthDecisionForRequest: React.FC<{
  correlationId: string;
  endpointId?: string;
  'data-testid'?: string;
}> = ({ correlationId, endpointId, 'data-testid': testId = 'log-detail-auth-section' }) => {
  const classes = useStyles();
  const { data, isLoading, error } = useAuthDecisions({ endpointId, limit: 50 });
  const record = (data?.records ?? []).find((r) => r.correlationId === correlationId);

  return (
    <div className={classes.root} data-testid={testId}>
      <div className={classes.header}>
        <Subtitle2>Authentication</Subtitle2>
        <Caption1 className={classes.hint}>
          The authentication decision for this request, joined by request id. Non-secret;
          short-lived diagnostics.
        </Caption1>
      </div>

      {isLoading && <LoadingSkeleton count={2} height="28px" />}

      {error && (
        <EmptyState
          title="Could not load the auth decision"
          body="The recent auth decisions could not be retrieved."
          data-testid={`${testId}-error`}
        />
      )}

      {!isLoading && !error && !record && (
        <EmptyState
          title="No auth decision for this request"
          body="This request produced no recorded auth decision - it may have authenticated on an earlier request, used a non-auth route, or the short-lived record has expired."
          data-testid={`${testId}-empty`}
        />
      )}

      {!isLoading && !error && record && (
        <div data-testid={`${testId}-record`}>
          <div className={classes.rowHeader}>
            {outcomeBadge(record)}
            <Text className={classes.mono}>{record.method}</Text>
            {record.reasonCode && <Caption1 className={classes.mono}>{record.reasonCode}</Caption1>}
            <Caption1 className={classes.hint}>
              {new Date(record.recordedAt).toLocaleTimeString()}
            </Caption1>
          </div>
          <DecisionDetail record={record} endpointId={endpointId} />
        </div>
      )}
    </div>
  );
};

export const AuthDiagnosticsPanel: React.FC<AuthDiagnosticsPanelProps> = ({
  endpointId,
  limit = 25,
  focusCorrelationId,
  onClearFocus,
  'data-testid': testId = 'auth-diagnostics-panel',
}) => {
  const classes = useStyles();
  const { data, isLoading, error } = useAuthDecisions({ endpointId, limit });

  // Phase 3 (auth-obs) - when focused from a request log, narrow the list
  // to the decision(s) that share the request's correlation id.
  const allRecords = data?.records ?? [];
  const records = focusCorrelationId
    ? allRecords.filter((r) => r.correlationId === focusCorrelationId)
    : allRecords;
  const openItems = focusCorrelationId ? records.map((r) => r.id) : undefined;

  return (
    <div className={classes.root} data-testid={testId}>
      <div className={classes.header}>
        <Subtitle2>Auth diagnostics</Subtitle2>
        <Caption1 className={classes.hint}>
          Recent authentication decisions {endpointId ? 'for this endpoint' : 'across all endpoints'}.
          A rejected attempt shows exactly which check failed (expected vs received) and how to fix it.
          All values are non-secret; short-lived diagnostics only.
        </Caption1>
        {focusCorrelationId && (
          <div className={classes.rowHeader} data-testid={`${testId}-focus`}>
            <Caption1 className={classes.hint}>
              Filtered to the request&apos;s auth decision.
            </Caption1>
            <Link data-testid={`${testId}-focus-clear`} onClick={() => onClearFocus?.()}>
              Show all
            </Link>
          </div>
        )}
      </div>

      {isLoading && <LoadingSkeleton count={3} height="28px" />}

      {error && (
        <EmptyState
          title="Could not load auth diagnostics"
          body="The recent auth decisions could not be retrieved."
          data-testid={`${testId}-error`}
        />
      )}

      {!isLoading && !error && records.length === 0 && (
        <EmptyState
          title={focusCorrelationId ? 'No auth decision for this request' : 'No recent auth decisions'}
          body={
            focusCorrelationId
              ? 'This request did not produce a recorded auth decision (it may have authenticated earlier or used a non-auth route).'
              : 'Auth decisions appear here as clients attempt to obtain a token. Try a connection from your IdP.'
          }
          data-testid={`${testId}-empty`}
        />
      )}

      {!isLoading && !error && records.length > 0 && (
        <Accordion multiple collapsible openItems={openItems} data-testid={`${testId}-list`}>
          {records.map((record) => (
            <AccordionItem value={record.id} key={record.id}>
              <AccordionHeader data-testid={`auth-decision-row-${record.id}`}>
                <div className={classes.rowHeader}>
                  {outcomeBadge(record)}
                  <Text className={classes.mono}>{record.method}</Text>
                  {record.reasonCode && (
                    <Caption1 className={classes.mono}>{record.reasonCode}</Caption1>
                  )}
                  <Caption1 className={classes.hint}>
                    {new Date(record.recordedAt).toLocaleTimeString()}
                  </Caption1>
                </div>
              </AccordionHeader>
              <AccordionPanel>
                <DecisionDetail record={record} endpointId={endpointId} />
              </AccordionPanel>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </div>
  );
};
