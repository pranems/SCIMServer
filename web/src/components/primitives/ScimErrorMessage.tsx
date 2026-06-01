/**
 * ScimErrorMessage - Phase K3 smart-error display primitive.
 *
 * Wraps Fluent UI's MessageBar and adds:
 *   - Plain-English title + explanation from SCIM_ERROR_CATALOG
 *     (looked up by scimType, with HTTP-status fallbacks for auth /
 *     forbidden / precondition / 5xx).
 *   - Optional server `detail` line under the explanation.
 *   - Optional "View details" expander showing the raw SCIM error
 *     body as pretty-printed JSON.
 *   - Optional external docs URL link (always opens in a new tab
 *     with `rel="noopener noreferrer"`).
 *   - Pass-through to the legacy primitive when error is
 *     null / undefined: returns null so callers can mount it
 *     unconditionally.
 *
 * Replaces the ad-hoc `<MessageBar><MessageBarTitle>Operation
 * failed</MessageBarTitle>{detail}</MessageBar>` patterns that
 * existed across CredentialsTab / ManualProvisionPage /
 * ResourceDetailDrawer pre-K3.
 *
 * @see docs/PHASE_K3_SMART_ERROR_EXPLAINER.md
 */
import React from 'react';
import {
  Button,
  Link,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  makeStyles,
  tokens,
  type MessageBarIntent,
} from '@fluentui/react-components';
import { ChevronDown16Regular, ChevronRight16Regular } from '@fluentui/react-icons';
import { parseScimError } from '../../api/scim-error';
import { CopyableField } from './CopyableField';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  detail: {
    color: tokens.colorNeutralForeground2,
    fontSize: '12px',
    fontFamily: 'monospace',
    wordBreak: 'break-word',
  },
  inlineRow: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    minWidth: 0,
  },
  preRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  preToolbar: {
    display: 'flex',
    justifyContent: 'flex-end',
  },
  linkRow: {
    fontSize: '12px',
  },
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
  },
  pre: {
    fontFamily: 'monospace',
    fontSize: '11px',
    backgroundColor: tokens.colorNeutralBackground3,
    padding: '8px',
    borderRadius: tokens.borderRadiusMedium,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    maxHeight: '320px',
    overflow: 'auto',
    margin: 0,
  },
  requestId: {
    fontFamily: 'monospace',
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
  },
});

export interface ScimErrorMessageProps {
  /**
   * The error to render. Pass anything: a `ScimApiError`, a plain
   * `Error`, a `string`, or `null` / `undefined`. When falsy this
   * component renders nothing so it is safe to mount unconditionally.
   */
  error: unknown;
  /** MessageBar intent. Defaults to 'error'. */
  intent?: MessageBarIntent;
  /** Custom data-testid root. Defaults to 'scim-error-message'. */
  'data-testid'?: string;
}

export const ScimErrorMessage: React.FC<ScimErrorMessageProps> = ({
  error,
  intent = 'error',
  'data-testid': dataTestId = 'scim-error-message',
}) => {
  const classes = useStyles();
  const [showRaw, setShowRaw] = React.useState(false);

  if (error === null || error === undefined) return null;

  const parsed = parseScimError(error);
  const { catalogEntry, detail, rawBody, requestId } = parsed;
  const hasRawBody = rawBody !== undefined;

  return (
    <MessageBar intent={intent} data-testid={dataTestId} className={classes.root}>
      <MessageBarBody>
        <MessageBarTitle>
          <span data-testid="scim-error-title">{catalogEntry.title}</span>
        </MessageBarTitle>
        <div className={classes.body}>
          <span>{catalogEntry.explanation}</span>
          {detail && detail !== catalogEntry.explanation ? (
            <span className={classes.inlineRow}>
              <span className={classes.detail} data-testid="scim-error-detail">
                {detail}
              </span>
              <CopyableField
                value=""
                copyValue={detail}
                buttonOnly
                ariaLabel="Copy error detail"
                data-testid="scim-error-detail-action"
              />
            </span>
          ) : null}
          {requestId ? (
            <span className={classes.inlineRow}>
              <span className={classes.requestId} data-testid="scim-error-request-id">
                Request id: {requestId}
              </span>
              <CopyableField
                value=""
                copyValue={requestId}
                buttonOnly
                ariaLabel="Copy request id"
                data-testid="scim-error-request-id-action"
              />
            </span>
          ) : null}
          {catalogEntry.docsUrl ? (
            <span className={classes.linkRow}>
              <Link
                href={catalogEntry.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="scim-error-docs-link"
              >
                Read the spec
              </Link>
            </span>
          ) : null}
          {hasRawBody ? (
            <div className={classes.toggleRow}>
              <Button
                appearance="subtle"
                size="small"
                icon={showRaw ? <ChevronDown16Regular /> : <ChevronRight16Regular />}
                onClick={() => setShowRaw((s) => !s)}
                data-testid="scim-error-toggle-raw"
                aria-expanded={showRaw}
              >
                {showRaw ? 'Hide details' : 'View details'}
              </Button>
            </div>
          ) : null}
          {showRaw && hasRawBody ? (
            <div className={classes.preRow}>
              <div className={classes.preToolbar}>
                <CopyableField
                  value=""
                  copyValue={prettyJson(rawBody)}
                  buttonOnly
                  ariaLabel="Copy raw error body"
                  data-testid="scim-error-raw-json-action"
                />
              </div>
              <pre className={classes.pre} data-testid="scim-error-raw-json">
                {prettyJson(rawBody)}
              </pre>
            </div>
          ) : null}
        </div>
      </MessageBarBody>
    </MessageBar>
  );
};

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
