/**
 * WorkbenchPage (Phase Q4 redesign) - the SCIM Workbench.
 *
 * Redesigned 2026-05-29 after operator feedback that the side-by-side
 * request / response layout cramped both panes into ~50% width each,
 * making JSON unreadable. New layout (top to bottom):
 *
 *   1. Header strip: title + description
 *   2. Top toolbar card:
 *      - Method picker, Path input (with autocomplete datalist for
 *        common SCIM paths), Endpoint convenience picker, Send button
 *      - Action row: Copy as curl / TypeScript / Insomnia / Postman,
 *        Export request as .json file (Insomnia / Postman / plain)
 *   3. Headers card (collapsible, default closed):
 *      - KV editor: add / remove rows, per-row copy
 *      - Quick-add buttons for common SCIM headers
 *   4. Request body card (full width):
 *      - Toolbar: Copy as text / Copy as JSON / Format JSON / Undo /
 *        Redo / Clear
 *      - Large textarea (~36vh min-height, monospace)
 *   5. Response card (full width):
 *      - Status + duration + requestId badges
 *      - Toolbar: Copy as text / Copy as JSON / Export .json file
 *      - Body: CopyableJsonBlock when structured, plain pre + copy
 *        button when text
 *   6. History card (last 50, newest first)
 *
 * Operator workflow now reads top-to-bottom and each pane gets the
 * full viewport width.
 *
 * @see web/src/utils/workbench-export.ts - serializers
 * @see docs/PHASE_M1_SCIM_WORKBENCH.md - original M1 design
 */
import React, { useMemo, useState } from 'react';
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
  Tooltip,
} from '@fluentui/react-components';
import {
  Send24Regular,
  Copy16Regular,
  Delete24Regular,
  History24Regular,
  Beaker24Regular,
  Save24Regular,
  ArrowDownload20Regular,
  ChevronDown20Regular,
  ChevronRight20Regular,
  Add16Regular,
  Dismiss16Regular,
  ArrowSync20Regular,
  Code16Regular,
  DocumentText16Regular,
  LayoutColumnTwo20Regular,
  LayoutRowTwo20Regular,
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
import {
  toCurl,
  toFetchSnippet,
  toInsomnia,
  toPostman,
  downloadJson,
  SCIM_PATH_SUGGESTIONS,
  type WorkbenchRequestEnvelope,
  type WorkbenchHeader,
} from '../utils/workbench-export';
import {
  CopyableField,
  CopyableJsonBlock,
  CopyJsonButton,
} from '../components/primitives';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const METHODS_WITH_BODY: HttpMethod[] = ['POST', 'PUT', 'PATCH'];

const HEADER_QUICK_ADD: ReadonlyArray<{ key: string; value: string }> = [
  { key: 'Content-Type', value: 'application/scim+json' },
  { key: 'Accept', value: 'application/scim+json' },
  { key: 'If-Match', value: 'W/"v1"' },
  { key: 'If-None-Match', value: '*' },
  { key: 'Prefer', value: 'return=representation' },
  { key: 'X-Request-Id', value: '<uuid>' },
];

const useStyles = makeStyles({
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    maxWidth: '1440px',
    margin: '0 auto',
    padding: '24px',
  },
  pageHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  toolbarCard: {
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
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
    alignItems: 'center',
  },
  bodyResponseWrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    minWidth: 0,
  },
  bodyResponseHorizontal: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px',
    minWidth: 0,
    '@media (max-width: 900px)': {
      gridTemplateColumns: '1fr',
    },
    '& > *': {
      minWidth: 0,
    },
  },
  sectionCard: {
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    flexWrap: 'wrap',
  },
  sectionHeaderLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  bodyToolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexWrap: 'wrap',
  },
  bodyTextarea: {
    width: '100%',
    minHeight: '36vh',
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
  },
  bodyPre: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    overflowWrap: 'anywhere',
    margin: 0,
    padding: '8px',
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusSmall,
    minHeight: '24vh',
    maxHeight: '60vh',
    overflowY: 'auto',
    minWidth: 0,
    maxWidth: '100%',
    boxSizing: 'border-box',
  },
  responseHeaderRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
  },
  headerRowsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 2fr auto auto',
    gap: '6px',
    alignItems: 'center',
  },
  headerCell: {
    minWidth: 0,
  },
  collapsibleHeader: {
    cursor: 'pointer',
    userSelect: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
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

function tryFormatJson(text: string): { ok: true; formatted: string } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(text);
    return { ok: true, formatted: JSON.stringify(parsed, null, 2) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── Component ───────────────────────────────────────────────────────

export const WorkbenchPage: React.FC = () => {
  const classes = useStyles();
  const search = useSearch({ strict: false }) as Record<string, unknown>;

  const endpoints = useEndpoints();
  const sendReq = useScimRequest();
  const { copy } = useCopyToClipboard();

  const prefilled = useMemo(() => parsePrefill(search?.prefill), [search]);

  const [method, setMethod] = useState<HttpMethod>(prefilled.method ?? 'GET');
  const [path, setPath] = useState<string>(prefilled.path ?? '');
  const [bodyText, setBodyText] = useState<string>(
    prefilled.body !== undefined ? JSON.stringify(prefilled.body, null, 2) : '',
  );
  const [pickedEp, setPickedEp] = useState<string>('');
  const [response, setResponse] = useState<ScimRequestOutcome | null>(null);
  const [bodyParseError, setBodyParseError] = useState<string | null>(null);

  const [headers, setHeaders] = useState<WorkbenchHeader[]>([
    { key: 'Content-Type', value: 'application/scim+json', enabled: true },
    { key: 'Accept', value: 'application/scim+json', enabled: true },
  ]);
  const [headersOpen, setHeadersOpen] = useState(false);

  const [layoutMode, setLayoutMode] = useState<'vertical' | 'horizontal'>(() => {
    if (typeof window === 'undefined') return 'vertical';
    return window.localStorage.getItem('scimserver:workbench:layout') === 'horizontal'
      ? 'horizontal'
      : 'vertical';
  });
  const toggleLayoutMode = (): void => {
    setLayoutMode((prev) => {
      const next = prev === 'vertical' ? 'horizontal' : 'vertical';
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('scimserver:workbench:layout', next);
      }
      return next;
    });
  };

  const [bodyHistory, setBodyHistory] = useState<string[]>([bodyText]);
  const [bodyCursor, setBodyCursor] = useState(0);

  const [historyTick, setHistoryTick] = useState(0);
  const history = useMemo<WorkbenchHistoryEntry[]>(() => loadHistory(), [historyTick]);

  const showBody = METHODS_WITH_BODY.includes(method);

  const pushBodyHistory = (next: string): void => {
    setBodyHistory((prev) => {
      const trimmed = prev.slice(0, bodyCursor + 1);
      trimmed.push(next);
      const overflow = trimmed.length - 50;
      return overflow > 0 ? trimmed.slice(overflow) : trimmed;
    });
    setBodyCursor((c) => Math.min(c + 1, 49));
  };

  const updateBody = (next: string): void => {
    pushBodyHistory(next);
    setBodyText(next);
  };

  const handleBodyUndo = (): void => {
    if (bodyCursor > 0) {
      const next = bodyHistory[bodyCursor - 1];
      setBodyCursor(bodyCursor - 1);
      setBodyText(next);
    }
  };

  const handleBodyRedo = (): void => {
    if (bodyCursor < bodyHistory.length - 1) {
      const next = bodyHistory[bodyCursor + 1];
      setBodyCursor(bodyCursor + 1);
      setBodyText(next);
    }
  };

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
    const next = entry.requestBody !== undefined ? JSON.stringify(entry.requestBody, null, 2) : '';
    pushBodyHistory(next);
    setBodyText(next);
  };

  const buildEnvelope = (): WorkbenchRequestEnvelope => {
    const { body } = buildArgs();
    return {
      method,
      url: path,
      baseUrl: typeof window !== 'undefined' ? window.location.origin : undefined,
      body,
      headers,
      name: `${method} ${path}`,
    };
  };

  const handleCopyCurl = (): void => void copy(toCurl(buildEnvelope()));
  const handleCopyTs = (): void => void copy(toFetchSnippet(buildEnvelope()));
  const handleCopyInsomnia = (): void => void copy(JSON.stringify(toInsomnia(buildEnvelope()), null, 2));
  const handleCopyPostman = (): void => void copy(JSON.stringify(toPostman(buildEnvelope()), null, 2));

  const handleExportInsomniaFile = (): void => {
    downloadJson(`scim-workbench-insomnia-${Date.now()}.json`, toInsomnia(buildEnvelope()));
  };
  const handleExportPostmanFile = (): void => {
    downloadJson(`scim-workbench-postman-${Date.now()}.json`, toPostman(buildEnvelope()));
  };
  const handleExportRequestFile = (): void => {
    downloadJson(`scim-workbench-request-${Date.now()}.json`, buildEnvelope());
  };
  const handleExportResponseFile = (): void => {
    if (!response) return;
    downloadJson(`scim-workbench-response-${Date.now()}.json`, response.body ?? null);
  };

  const updateHeader = (i: number, patch: Partial<WorkbenchHeader>): void => {
    setHeaders((prev) => prev.map((h, idx) => (idx === i ? { ...h, ...patch } : h)));
  };
  const removeHeader = (i: number): void => {
    setHeaders((prev) => prev.filter((_h, idx) => idx !== i));
  };
  const addHeader = (init?: Partial<WorkbenchHeader>): void => {
    setHeaders((prev) => [...prev, { key: init?.key ?? '', value: init?.value ?? '', enabled: true }]);
  };

  const handleFormatBody = (): void => {
    if (bodyText.trim().length === 0) return;
    const r = tryFormatJson(bodyText);
    if (r.ok) {
      updateBody(r.formatted);
      setBodyParseError(null);
    } else {
      setBodyParseError(r.error);
    }
  };
  const handleClearBody = (): void => {
    if (bodyText.length > 0) updateBody('');
  };
  const handleCopyBodyText = (): void => void copy(bodyText);
  const handleCopyBodyJson = (): void => {
    const r = tryFormatJson(bodyText);
    void copy(r.ok ? r.formatted : bodyText);
  };

  const responseBodyText = (): string => {
    if (!response || response.body === undefined) return '';
    if (typeof response.body === 'string') return response.body;
    try {
      return JSON.stringify(response.body, null, 2);
    } catch {
      return String(response.body);
    }
  };
  const handleCopyResponseText = (): void => void copy(responseBodyText());
  const handleCopyResponseJson = (): void => {
    if (!response || response.body === undefined) return;
    if (typeof response.body === 'string') {
      void copy(response.body);
    } else {
      try {
        void copy(JSON.stringify(response.body, null, 2));
      } catch {
        void copy(String(response.body));
      }
    }
  };

  const handleClearHistory = (): void => {
    clearHistory();
    setHistoryTick((n) => n + 1);
  };

  const endpointList = endpoints.data?.endpoints ?? [];
  const canExport = path.trim().length > 0;
  const canUndoBody = bodyCursor > 0;
  const canRedoBody = bodyCursor < bodyHistory.length - 1;

  return (
    <div className={classes.page} data-testid="workbench-page">
      <div className={classes.pageHeader}>
        <Beaker24Regular />
        <Subtitle1>Workbench</Subtitle1>
      </div>
      <Caption1>
        Free-form SCIM request builder. Compose a request once, then copy or export it as curl,
        TypeScript, Insomnia, or Postman; or send it directly under <code>/scim/*</code> and inspect
        the response. The last 50 requests are saved locally.
      </Caption1>

      <Card className={classes.toolbarCard} data-testid="workbench-toolbar-card">
        <div className={classes.toolbar}>
          <Field label="Method">
            <select
              aria-label="HTTP method"
              data-testid="workbench-method"
              value={method}
              onChange={(e) => setMethod(e.target.value as HttpMethod)}
              className={classes.headerCell}
              style={{ height: '32px', padding: '0 8px', fontFamily: tokens.fontFamilyMonospace }}
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="Path (under /scim/*) - type or pick from common paths">
            <Input
              value={path}
              onChange={(_e, d) => setPath(d.value)}
              placeholder="/scim/endpoints/<id>/Users"
              data-testid="workbench-path"
              list="workbench-path-suggestions"
              input={{ style: { fontFamily: tokens.fontFamilyMonospace } }}
            />
            <datalist id="workbench-path-suggestions">
              {SCIM_PATH_SUGGESTIONS.map((p) => (
                <option key={p} value={p} />
              ))}
              {endpointList.map((ep) => (
                <option key={`base-${ep.id}`} value={`/scim/endpoints/${ep.id}/Users`} />
              ))}
            </datalist>
          </Field>
          <Field label="Endpoint pre-fill">
            <select
              aria-label="Endpoint pre-fill"
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

        <div className={classes.actionRow} data-testid="workbench-export-row">
          <Button
            appearance="secondary"
            icon={<Copy16Regular />}
            onClick={handleCopyCurl}
            disabled={!canExport}
            data-testid="workbench-copy-curl"
          >
            Copy as curl
          </Button>
          <Button
            appearance="secondary"
            icon={<Copy16Regular />}
            onClick={handleCopyTs}
            disabled={!canExport}
            data-testid="workbench-copy-ts"
          >
            Copy as TypeScript
          </Button>
          <Tooltip
            relationship="label"
            content="Copy an Insomnia v4 export JSON. Paste into Insomnia > Application > Import > From Clipboard."
          >
            <Button
              appearance="secondary"
              icon={<Code16Regular />}
              onClick={handleCopyInsomnia}
              disabled={!canExport}
              data-testid="workbench-copy-insomnia"
            >
              Copy for Insomnia
            </Button>
          </Tooltip>
          <Tooltip
            relationship="label"
            content="Copy a Postman Collection v2.1 JSON. Paste into Postman > File > Import > Raw text."
          >
            <Button
              appearance="secondary"
              icon={<Code16Regular />}
              onClick={handleCopyPostman}
              disabled={!canExport}
              data-testid="workbench-copy-postman"
            >
              Copy for Postman
            </Button>
          </Tooltip>
          <Tooltip relationship="label" content="Download the request envelope as a standalone JSON file.">
            <Button
              appearance="secondary"
              icon={<ArrowDownload20Regular />}
              onClick={handleExportRequestFile}
              disabled={!canExport}
              data-testid="workbench-export-request"
            >
              Export request .json
            </Button>
          </Tooltip>
          <Tooltip relationship="label" content="Download as an Insomnia v4 import file.">
            <Button
              appearance="subtle"
              icon={<ArrowDownload20Regular />}
              onClick={handleExportInsomniaFile}
              disabled={!canExport}
              data-testid="workbench-export-insomnia"
            >
              Export Insomnia file
            </Button>
          </Tooltip>
          <Tooltip relationship="label" content="Download as a Postman v2.1 collection file.">
            <Button
              appearance="subtle"
              icon={<ArrowDownload20Regular />}
              onClick={handleExportPostmanFile}
              disabled={!canExport}
              data-testid="workbench-export-postman"
            >
              Export Postman file
            </Button>
          </Tooltip>
          <Tooltip
            relationship="label"
            content={
              layoutMode === 'vertical'
                ? 'Switch to side-by-side layout (request left, response right).'
                : 'Switch to stacked layout (request on top, response below).'
            }
          >
            <Button
              appearance="subtle"
              icon={layoutMode === 'vertical' ? <LayoutColumnTwo20Regular /> : <LayoutRowTwo20Regular />}
              onClick={toggleLayoutMode}
              data-testid="workbench-layout-toggle"
              aria-pressed={layoutMode === 'horizontal'}
            >
              {layoutMode === 'vertical' ? 'Side-by-side' : 'Stacked'}
            </Button>
          </Tooltip>
        </div>
      </Card>

      <Card className={classes.sectionCard} data-testid="workbench-headers-card">
        <div
          className={classes.collapsibleHeader}
          onClick={() => setHeadersOpen((v) => !v)}
          data-testid="workbench-headers-toggle"
        >
          {headersOpen ? <ChevronDown20Regular /> : <ChevronRight20Regular />}
          <Subtitle2>Request headers ({headers.filter((h) => h.enabled !== false).length} active)</Subtitle2>
        </div>
        {headersOpen && (
          <>
            <div className={classes.headerRowsGrid} data-testid="workbench-headers-grid">
              {headers.map((h, i) => (
                <React.Fragment key={`hdr-${i}`}>
                  <Input
                    value={h.key}
                    onChange={(_e, d) => updateHeader(i, { key: d.value })}
                    placeholder="Header name"
                    data-testid={`workbench-header-key-${i}`}
                    input={{ style: { fontFamily: tokens.fontFamilyMonospace } }}
                  />
                  <Input
                    value={h.value}
                    onChange={(_e, d) => updateHeader(i, { value: d.value })}
                    placeholder="Header value"
                    data-testid={`workbench-header-value-${i}`}
                    input={{ style: { fontFamily: tokens.fontFamilyMonospace } }}
                  />
                  <CopyableField
                    value=""
                    copyValue={`${h.key}: ${h.value}`}
                    buttonOnly
                    ariaLabel={`Copy header ${h.key}`}
                    data-testid={`workbench-header-copy-${i}`}
                  />
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={<Dismiss16Regular />}
                    onClick={() => removeHeader(i)}
                    aria-label={`Remove header ${h.key}`}
                    data-testid={`workbench-header-remove-${i}`}
                  />
                </React.Fragment>
              ))}
            </div>
            <div className={classes.actionRow}>
              <Button
                appearance="secondary"
                size="small"
                icon={<Add16Regular />}
                onClick={() => addHeader()}
                data-testid="workbench-header-add"
              >
                Add header
              </Button>
              {HEADER_QUICK_ADD.map((preset) => (
                <Button
                  key={preset.key}
                  appearance="subtle"
                  size="small"
                  onClick={() => addHeader(preset)}
                  data-testid={`workbench-header-quickadd-${preset.key}`}
                >
                  + {preset.key}
                </Button>
              ))}
            </div>
          </>
        )}
      </Card>

      <div
        className={
          layoutMode === 'horizontal'
            ? classes.bodyResponseHorizontal
            : classes.bodyResponseWrapper
        }
        data-testid="workbench-body-response-wrapper"
        data-layout={layoutMode}
      >
      <Card className={classes.sectionCard} data-testid="workbench-body-card">
        <div className={classes.sectionHeader}>
          <Subtitle2>Request body {showBody ? '' : `(omitted for ${method})`}</Subtitle2>
          {showBody && (
            <div className={classes.bodyToolbar} data-testid="workbench-body-toolbar">
              <Tooltip relationship="label" content="Copy as plain text">
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<DocumentText16Regular />}
                  onClick={handleCopyBodyText}
                  data-testid="workbench-body-copy-text"
                  aria-label="Copy body as plain text"
                />
              </Tooltip>
              <Tooltip relationship="label" content="Copy as JSON (formatted)">
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<Code16Regular />}
                  onClick={handleCopyBodyJson}
                  data-testid="workbench-body-copy-json"
                  aria-label="Copy body as formatted JSON"
                />
              </Tooltip>
              <Tooltip relationship="label" content="Format JSON (prettify)">
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<ArrowSync20Regular />}
                  onClick={handleFormatBody}
                  data-testid="workbench-body-format"
                  aria-label="Format JSON"
                >
                  Format
                </Button>
              </Tooltip>
              <Button
                appearance="subtle"
                size="small"
                onClick={handleBodyUndo}
                disabled={!canUndoBody}
                data-testid="workbench-body-undo"
                aria-label="Undo body edit"
              >
                Undo
              </Button>
              <Button
                appearance="subtle"
                size="small"
                onClick={handleBodyRedo}
                disabled={!canRedoBody}
                data-testid="workbench-body-redo"
                aria-label="Redo body edit"
              >
                Redo
              </Button>
              <Button
                appearance="subtle"
                size="small"
                icon={<Dismiss16Regular />}
                onClick={handleClearBody}
                disabled={bodyText.length === 0}
                data-testid="workbench-body-clear"
                aria-label="Clear body"
              >
                Clear
              </Button>
            </div>
          )}
        </div>
        {showBody ? (
          <>
            <Textarea
              value={bodyText}
              onChange={(_e, d) => updateBody(d.value)}
              placeholder='{"schemas":["urn:ietf:params:scim:schemas:core:2.0:User"],"userName":"alice@corp.com"}'
              data-testid="workbench-body"
              textarea={{ className: classes.bodyTextarea }}
            />
            {bodyParseError && (
              <Caption1 style={{ color: tokens.colorPaletteRedForeground1 }} data-testid="workbench-body-parse-error">
                JSON parse error: {bodyParseError}
              </Caption1>
            )}
          </>
        ) : (
          <Caption1>Body is omitted for {method} requests.</Caption1>
        )}
      </Card>

      <Card className={classes.sectionCard} data-testid="workbench-response-card">
        <div className={classes.sectionHeader}>
          <Subtitle2>Response</Subtitle2>
          {response && (
            <div className={classes.bodyToolbar} data-testid="workbench-response-toolbar">
              <Tooltip relationship="label" content="Copy response body as plain text">
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<DocumentText16Regular />}
                  onClick={handleCopyResponseText}
                  data-testid="workbench-response-copy-text"
                  aria-label="Copy response body as plain text"
                />
              </Tooltip>
              <Tooltip relationship="label" content="Copy response body as JSON">
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<Code16Regular />}
                  onClick={handleCopyResponseJson}
                  data-testid="workbench-response-copy-json"
                  aria-label="Copy response body as JSON"
                />
              </Tooltip>
              <Tooltip relationship="label" content="Download response body as .json file">
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<ArrowDownload20Regular />}
                  onClick={handleExportResponseFile}
                  data-testid="workbench-response-export"
                  aria-label="Export response body as .json"
                >
                  Export .json
                </Button>
              </Tooltip>
            </div>
          )}
        </div>
        {response ? (
          <div data-testid="workbench-response">
            <div className={classes.responseHeaderRow}>
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
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <Caption1>requestId:</Caption1>
                  <CopyableField
                    value={response.requestId}
                    monospace
                    truncate
                    maxWidth="240px"
                    ariaLabel="Copy requestId"
                    data-testid="workbench-response-request-id"
                  />
                </span>
              )}
            </div>
            {response.body !== undefined && typeof response.body !== 'string' ? (
              <CopyableJsonBlock
                value={response.body}
                maxHeight="60vh"
                data-testid="workbench-response-body"
              />
            ) : (
              <pre className={classes.bodyPre} data-testid="workbench-response-body-pre">
                {response.body !== undefined
                  ? typeof response.body === 'string'
                    ? response.body
                    : JSON.stringify(response.body, null, 2)
                  : '(no body)'}
              </pre>
            )}
          </div>
        ) : (
          <Caption1>Send a request to see the response here.</Caption1>
        )}
      </Card>
      </div>

      <Card className={classes.sectionCard} data-testid="workbench-history">
        <div className={classes.sectionHeader}>
          <div className={classes.sectionHeaderLeft}>
            <History24Regular />
            <Subtitle2>History (last 50, newest first)</Subtitle2>
          </div>
          {history.length > 0 && (
            <div className={classes.actionRow}>
              <CopyJsonButton
                value={history}
                label="Copy all history as JSON"
                data-testid="workbench-history-copy-json"
              />
              <Button
                appearance="subtle"
                icon={<Delete24Regular />}
                onClick={handleClearHistory}
                data-testid="workbench-clear-history"
              >
                Clear
              </Button>
            </div>
          )}
        </div>
        {history.length === 0 ? (
          <Caption1>No requests yet. Send one to start building history.</Caption1>
        ) : (
          <table className={classes.historyTable}>
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
                    <CopyableField
                      value={entry.path}
                      copyValue={entry.path}
                      truncate
                      monospace
                      maxWidth="360px"
                      data-testid={`workbench-history-path-${entry.id}`}
                    />
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
                        void copy(snippet);
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
