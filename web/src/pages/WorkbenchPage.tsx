/**
 * WorkbenchPage (Phase M1) - the SCIM Workbench.
 *
 * Per [docs/UI_NEXT_GAPS_LATERAL_ANALYSIS_2026.md S4.2] this is the
 * "killer feature" that collapses 4 separate Tier-1 gaps (PATCH
 * builder, filter builder, Bulk submitter, Discovery explorer) into
 * one composable workbench. M1 ships the minimal viable page:
 *
 *   - Top toolbar: method picker / path input / endpoint convenience
 *     picker / Send button / Copy-as-curl / Copy-as-TS
 *   - Body editor (visible only for POST/PUT/PATCH; monospace textarea)
 *   - Response viewer: status badge + duration ms + requestId + body
 *   - History: ring buffer of last 50 requests persisted to localStorage,
 *     newest-first; click any row to re-seed the toolbar from it
 *
 * URL `?prefill=<urlencoded-JSON>` seeds method/path/body so the L5
 * Discovery Explorer's "Open in Workbench" button can deep-link.
 *
 * Out of scope for M1 (deferred):
 *   - Visual filter / PATCH builder UI (the reducers ship in M1; the
 *     visual click-to-build forms are deferred to N6)
 *   - Snippet save/export (deferred to N4 settings persistence)
 *   - Diff tab on response viewer (deferred to M2)
 *
 * @see docs/PHASE_M1_SCIM_WORKBENCH.md
 * @see web/src/utils/workbench-history.ts
 * @see web/src/utils/filter-builder.ts
 * @see web/src/utils/patch-builder.ts
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  makeStyles,
  tokens,
  Card,
  Subtitle1,
  Subtitle2,
  Caption1,
  Text,
  Badge,
  Button,
  Field,
  Input,
  Textarea,
} from '@fluentui/react-components';
import {
  Send24Regular,
  Copy16Regular,
  Delete24Regular,
  History24Regular,
  Beaker24Regular,
  Save24Regular,
} from '@fluentui/react-icons';
import { useSearch } from '@tanstack/react-router';
import { useEndpoints, useScimRequest, type ScimRequestOutcome } from '../api/queries';
import {
  loadHistory,
  appendHistory,
  clearHistory,
  type WorkbenchHistoryEntry,
} from '../utils/workbench-history';
import { emitLiveTestSnippet } from '../utils/live-test-snippet';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const METHODS_WITH_BODY: HttpMethod[] = ['POST', 'PUT', 'PATCH'];

const useStyles = makeStyles({
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    maxWidth: '1280px',
    margin: '0 auto',
    padding: '24px',
  },
  toolbar: {
    display: 'grid',
    gridTemplateColumns: '120px 1fr 220px auto',
    gap: '8px',
    alignItems: 'end',
  },
  actionRow: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  splitPane: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px',
  },
  paneCard: {
    padding: '12px',
    minHeight: '320px',
  },
  bodyTextarea: {
    width: '100%',
    minHeight: '280px',
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
  },
  responseHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '8px',
    flexWrap: 'wrap',
  },
  responseBody: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: 'pre-wrap',
    margin: 0,
    overflowX: 'auto',
  },
  historyTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: tokens.fontSizeBase200,
  },
  historyRow: {
    cursor: 'pointer',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  historyCell: {
    padding: '6px 8px',
  },
});

interface ParsedPrefill {
  method?: HttpMethod;
  path?: string;
  body?: unknown;
}

function parsePrefill(raw: unknown): ParsedPrefill {
  if (typeof raw !== 'string' || raw.length === 0) return {};
  try {
    const decoded = decodeURIComponent(raw);
    const obj = JSON.parse(decoded) as Record<string, unknown>;
    const method = obj.method;
    const path = obj.path;
    return {
      method: METHODS.includes(method as HttpMethod) ? (method as HttpMethod) : undefined,
      path: typeof path === 'string' ? path : undefined,
      body: obj.body,
    };
  } catch {
    return {};
  }
}

function statusColor(status: number): 'success' | 'warning' | 'danger' | 'subtle' {
  if (status >= 200 && status < 300) return 'success';
  if (status >= 300 && status < 400) return 'warning';
  if (status >= 400) return 'danger';
  return 'subtle';
}

// ─── Component ───────────────────────────────────────────────────────

export const WorkbenchPage: React.FC = () => {
  const classes = useStyles();
  const search = useSearch({ strict: false }) as Record<string, unknown>;

  const endpoints = useEndpoints();
  const sendReq = useScimRequest();

  const prefilled = useMemo(() => parsePrefill(search?.prefill), [search]);

  const [method, setMethod] = useState<HttpMethod>(prefilled.method ?? 'GET');
  const [path, setPath] = useState<string>(prefilled.path ?? '');
  const [bodyText, setBodyText] = useState<string>(
    prefilled.body !== undefined ? JSON.stringify(prefilled.body, null, 2) : '',
  );
  const [pickedEp, setPickedEp] = useState<string>('');
  const [response, setResponse] = useState<ScimRequestOutcome | null>(null);
  const [bodyParseError, setBodyParseError] = useState<string | null>(null);

  // History snapshot - re-read on every successful Send so the list
  // reflects the latest entry without an effect dep cycle.
  const [historyTick, setHistoryTick] = useState(0);
  const history = useMemo<WorkbenchHistoryEntry[]>(() => loadHistory(), [historyTick]);

  const showBody = METHODS_WITH_BODY.includes(method);

  const handleEndpointPick = (epId: string): void => {
    setPickedEp(epId);
    if (epId) {
      setPath(`/scim/endpoints/${epId}/Users`);
    }
  };

  const buildArgs = (): { body?: unknown; bodyError?: string } => {
    if (!showBody || bodyText.trim().length === 0) return { body: undefined };
    try {
      const parsed = JSON.parse(bodyText);
      return { body: parsed };
    } catch (e) {
      return { bodyError: e instanceof Error ? e.message : String(e) };
    }
  };

  const handleSend = async (): Promise<void> => {
    setResponse(null);
    setBodyParseError(null);
    const { body, bodyError } = buildArgs();
    if (bodyError) {
      setBodyParseError(bodyError);
      return;
    }
    try {
      const outcome = await sendReq.mutateAsync({ method, path, body });
      setResponse(outcome);
      // Append to history (newest-first).
      appendHistory({
        id: `wb-${Date.now()}`,
        method,
        path,
        status: outcome.status,
        durationMs: outcome.durationMs,
        requestId: outcome.requestId,
        timestamp: new Date().toISOString(),
        requestBody: body,
        responseBody: outcome.body,
      });
      setHistoryTick((n) => n + 1);
    } catch (e) {
      // Network-level error - surface as a synthetic response with
      // status 0 so the operator still sees it in the response viewer.
      setResponse({
        status: 0,
        durationMs: 0,
        body: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const handleHistoryRowClick = (entry: WorkbenchHistoryEntry): void => {
    setMethod(entry.method as HttpMethod);
    setPath(entry.path);
    setBodyText(entry.requestBody !== undefined ? JSON.stringify(entry.requestBody, null, 2) : '');
  };

  const buildCurlSnippet = (): string => {
    const { body } = buildArgs();
    const lines = [
      `curl -X '${method}' \\`,
      `  '${path}' \\`,
      `  -H 'Authorization: Bearer <token>' \\`,
      `  -H 'Content-Type: application/scim+json'`,
    ];
    if (body !== undefined) {
      lines[lines.length - 1] += ' \\';
      lines.push(`  -d '${JSON.stringify(body)}'`);
    }
    return lines.join('\n');
  };

  const buildTsSnippet = (): string => {
    const { body } = buildArgs();
    const opts: Record<string, unknown> = {
      method,
      headers: {
        'Authorization': 'Bearer <token>',
        'Content-Type': 'application/scim+json',
      },
    };
    if (body !== undefined) {
      opts.body = `JSON.stringify(${JSON.stringify(body)})`;
    }
    return `await fetch('${path}', ${JSON.stringify(opts, null, 2).replace(
      /"JSON.stringify\(([^)]+)\)"/,
      'JSON.stringify($1)',
    )});`;
  };

  const handleCopyCurl = (): void => {
    void navigator.clipboard.writeText(buildCurlSnippet());
  };

  const handleCopyTs = (): void => {
    void navigator.clipboard.writeText(buildTsSnippet());
  };

  const handleClearHistory = (): void => {
    clearHistory();
    setHistoryTick((n) => n + 1);
  };

  const endpointList = endpoints.data?.endpoints ?? [];

  return (
    <div className={classes.page} data-testid="workbench-page">
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Beaker24Regular />
        <Subtitle1>Workbench</Subtitle1>
      </div>
      <Caption1>
        Free-form SCIM request builder. Send arbitrary HTTP requests under `/scim/*`, see the response,
        copy as curl or TypeScript, and revisit the last 50 requests from your local history.
      </Caption1>

      {/* Top toolbar */}
      <Card style={{ padding: '12px' }}>
        <div className={classes.toolbar}>
          <Field label="Method">
            <select
              data-testid="workbench-method"
              value={method}
              onChange={(e) => setMethod(e.target.value as HttpMethod)}
              style={{
                height: '32px',
                fontFamily: tokens.fontFamilyMonospace,
                padding: '0 8px',
              }}
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="Path (under /scim/*)">
            <Input
              value={path}
              onChange={(_e, d) => setPath(d.value)}
              placeholder="/scim/endpoints/<id>/Users"
              data-testid="workbench-path"
              input={{ style: { fontFamily: tokens.fontFamilyMonospace } }}
            />
          </Field>
          <Field label="Endpoint pre-fill">
            <select
              data-testid="workbench-endpoint-picker"
              value={pickedEp}
              onChange={(e) => handleEndpointPick(e.target.value)}
              style={{ height: '32px', padding: '0 8px' }}
            >
              <option value="">- Pick an endpoint -</option>
              {endpointList.map((ep) => (
                <option key={ep.id} value={ep.id}>
                  {ep.displayName ?? ep.name}
                </option>
              ))}
            </select>
          </Field>
          <Button
            appearance="primary"
            icon={<Send24Regular />}
            onClick={() => void handleSend()}
            disabled={path.trim().length === 0 || sendReq.isPending}
            data-testid="workbench-send"
          >
            {sendReq.isPending ? 'Sending...' : 'Send'}
          </Button>
        </div>

        <div className={classes.actionRow} style={{ marginTop: '8px' }}>
          <Button
            appearance="secondary"
            icon={<Copy16Regular />}
            onClick={handleCopyCurl}
            disabled={path.trim().length === 0}
            data-testid="workbench-copy-curl"
          >
            Copy as curl
          </Button>
          <Button
            appearance="secondary"
            icon={<Copy16Regular />}
            onClick={handleCopyTs}
            disabled={path.trim().length === 0}
            data-testid="workbench-copy-ts"
          >
            Copy as TypeScript
          </Button>
        </div>
      </Card>

      {/* Body + Response split pane */}
      <div className={classes.splitPane}>
        <Card className={classes.paneCard}>
          <Subtitle2>Request body</Subtitle2>
          {showBody ? (
            <>
              <Textarea
                value={bodyText}
                onChange={(_e, d) => setBodyText(d.value)}
                placeholder='{"schemas":[...],"userName":"..."}'
                data-testid="workbench-body"
                textarea={{ className: classes.bodyTextarea }}
              />
              {bodyParseError && (
                <Caption1 style={{ color: tokens.colorPaletteRedForeground1 }}>
                  Body JSON parse error: {bodyParseError}
                </Caption1>
              )}
            </>
          ) : (
            <Caption1>Body is omitted for {method} requests.</Caption1>
          )}
        </Card>

        <Card className={classes.paneCard} data-testid="workbench-response-card">
          <Subtitle2>Response</Subtitle2>
          {response ? (
            <div data-testid="workbench-response">
              <div className={classes.responseHeader}>
                <Badge
                  appearance="filled"
                  color={statusColor(response.status)}
                  size="medium"
                  data-testid="workbench-response-status"
                >
                  {response.status || 'NETWORK'}
                </Badge>
                <Caption1 data-testid="workbench-response-duration">
                  {response.durationMs} ms
                </Caption1>
                {response.requestId && (
                  <Caption1 data-testid="workbench-response-request-id">
                    requestId: {response.requestId}
                  </Caption1>
                )}
              </div>
              <pre className={classes.responseBody} data-testid="workbench-response-body">
                {response.body !== undefined
                  ? typeof response.body === 'string'
                    ? response.body
                    : JSON.stringify(response.body, null, 2)
                  : '(no body)'}
              </pre>
            </div>
          ) : (
            <Caption1>Send a request to see the response here.</Caption1>
          )}
        </Card>
      </div>

      {/* History */}
      <Card style={{ padding: '12px' }} data-testid="workbench-history">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <History24Regular />
            <Subtitle2>History (last 50, newest first)</Subtitle2>
          </div>
          {history.length > 0 && (
            <Button
              appearance="subtle"
              icon={<Delete24Regular />}
              onClick={handleClearHistory}
              data-testid="workbench-clear-history"
            >
              Clear
            </Button>
          )}
        </div>
        {history.length === 0 ? (
          <Caption1 style={{ marginTop: '8px' }}>
            No requests yet. Send one to start building history.
          </Caption1>
        ) : (
          <table className={classes.historyTable} style={{ marginTop: '8px' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: tokens.colorNeutralForeground3 }}>time</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: tokens.colorNeutralForeground3 }}>method</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: tokens.colorNeutralForeground3 }}>path</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: tokens.colorNeutralForeground3 }}>status</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: tokens.colorNeutralForeground3 }}>ms</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: tokens.colorNeutralForeground3 }}>save</th>
              </tr>
            </thead>
            <tbody>
              {history.map((entry) => (
                <tr
                  key={entry.id}
                  className={classes.historyRow}
                  onClick={() => handleHistoryRowClick(entry)}
                  data-testid={`workbench-history-row-${entry.id}`}
                >
                  <td className={classes.historyCell}>
                    <Caption1>{new Date(entry.timestamp).toLocaleTimeString()}</Caption1>
                  </td>
                  <td className={classes.historyCell}>
                    <Text weight="semibold" style={{ fontFamily: tokens.fontFamilyMonospace }}>
                      {entry.method}
                    </Text>
                  </td>
                  <td className={classes.historyCell} style={{ fontFamily: tokens.fontFamilyMonospace }}>
                    {entry.path}
                  </td>
                  <td className={classes.historyCell}>
                    <Badge appearance="filled" color={statusColor(entry.status)} size="small">
                      {entry.status}
                    </Badge>
                  </td>
                  <td className={classes.historyCell}>
                    <Caption1>{entry.durationMs}</Caption1>
                  </td>
                  <td className={classes.historyCell}>
                    <Button
                      appearance="subtle"
                      size="small"
                      icon={<Save24Regular />}
                      onClick={(e) => {
                        e.stopPropagation();
                        const snippet = emitLiveTestSnippet({
                          method: entry.method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
                          path: entry.path,
                          body: entry.requestBody,
                          expectedStatus: entry.status,
                          label: `${entry.method} ${entry.path}`,
                        });
                        void navigator.clipboard.writeText(snippet);
                      }}
                      data-testid={`workbench-save-as-live-test-${entry.id}`}
                      title="Copy as live-test.ps1 snippet"
                    >
                      Save as live-test
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
};
