/**
 * ConnectionPanel (WI-4) - the single reusable component that renders an
 * endpoint's connection properties for an identity-provider operator (primarily
 * Microsoft Entra ID). It consumes the WI-2 `ConnectionInfo` shape (assembled
 * server-side; no URL hand-building) and presents, per auth method:
 *
 *   - the Entra "Authentication Method" label,
 *   - each Entra field as a read-only CopyableField (Tenant URL, Token
 *     Endpoint, Client Identifier, etc.),
 *   - the one-time secret (only in the create moment, with a "copy it now"
 *     warning) or a "shown once at creation" placeholder,
 *   - block-level export affordances: Copy all as JSON, Copy as .env, Download
 *     .json.
 *
 * Design: docs/auth/CONNECTION_INFO_AND_ENTRA_SETUP.md Part 8. All display
 * values go through the R9 primitives (CopyableField / CopyJsonButton); no
 * hand-rolled clipboard state. NO secret is ever present unless the caller
 * passes `oneTimeSecret` for the create moment.
 */
import * as React from 'react';
import { useState } from 'react';
import {
  makeStyles,
  tokens,
  Card,
  Text,
  Subtitle2,
  Caption1,
  Radio,
  RadioGroup,
  Button,
  Badge,
  MessageBar,
  MessageBarBody,
} from '@fluentui/react-components';import { ArrowDownload16Regular } from '@fluentui/react-icons';
import type {
  ConnectionInfo,
  ConnectionEnabledMethod,
  ConnectionMethod,
} from '@scim/types/connection-info.types';
import { CopyableField } from './CopyableField';
import { CopyJsonButton } from './CopyJsonButton';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' },
  methodRow: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' },
  fieldGrid: { display: 'flex', flexDirection: 'column', gap: '8px' },
  fieldRow: {
    display: 'grid',
    gridTemplateColumns: '220px 1fr',
    alignItems: 'start',
    gap: '12px',
    padding: '6px 0',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  labelCell: { display: 'flex', flexDirection: 'column', gap: '2px' },
  fieldLabel: { color: tokens.colorNeutralForeground2, fontWeight: tokens.fontWeightSemibold },
  fieldDesc: { color: tokens.colorNeutralForeground3 },
  intro: { color: tokens.colorNeutralForeground3, marginBottom: '4px' },
  actions: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '4px' },
  authMethod: { fontWeight: tokens.fontWeightSemibold },
  empty: { padding: '12px 0' },
});

/**
 * Field labels use Microsoft Entra ID's exact wording (so an operator pasting
 * into the Entra provisioning form recognizes each field 1:1), with the raw
 * key as a fallback.
 */
const FIELD_LABELS: Record<string, string> = {
  tenantUrl: 'Tenant URL',
  tokenEndpoint: 'OAuth token endpoint',
  clientIdentifier: 'Client ID',
  clientSecret: 'Client Secret',
  secretToken: 'Secret Token',
  expectedAudience: 'Audience',
};

/**
 * Generic, IdP-agnostic helper text for each field. SCIMServer targets ANY
 * SCIM 2.0 identity provider (Entra, Okta, OneLogin, Ping, custom clients), so
 * each description names Entra's label AND explains the field generically so a
 * non-Entra client operator knows where it goes.
 */
const FIELD_DESCRIPTIONS: Record<string, string> = {
  tenantUrl:
    'The SCIM base URL for this endpoint. Entra calls it "Tenant URL"; Okta/OneLogin/Ping call it the "SCIM base URL" / "Base URL". Paste it into your IdP\'s SCIM connector URL field.',
  secretToken:
    'The bearer token your IdP sends in the Authorization header. Entra calls it "Secret Token"; other clients call it "API token" / "bearer token".',
  tokenEndpoint:
    'The OAuth 2.0 token endpoint where the client exchanges its credentials for an access token (client_credentials grant). Entra calls it "OAuth token endpoint".',
  clientIdentifier:
    'The public client identifier for the OAuth client_credentials grant. Entra/Okta call it "Client ID".',
  clientSecret:
    'The confidential client secret for the OAuth client_credentials grant. Entra/Okta call it "Client Secret".',
  expectedAudience:
    'For Workload Identity Federation: the audience (aud) claim the source IdP token must carry when calling this endpoint.',
};

/** Map an Entra field key to its `.env` variable name. */
const ENV_KEYS: Record<string, string> = {
  tenantUrl: 'SCIM_TENANT_URL',
  tokenEndpoint: 'SCIM_TOKEN_ENDPOINT',
  clientIdentifier: 'SCIM_CLIENT_ID',
  clientSecret: 'SCIM_CLIENT_SECRET',
  secretToken: 'SCIM_SECRET_TOKEN',
  expectedAudience: 'SCIM_EXPECTED_AUDIENCE',
};

export interface ConnectionPanelProps {
  /** The assembled connection-info (WI-2 shape). */
  connectionInfo: ConnectionInfo;
  /**
   * Optional one-time secret for the create moment. When the selected method
   * matches, the secret is rendered (with a warning) and included in the
   * JSON / .env / download payloads. Never persisted.
   */
  oneTimeSecret?: { method: ConnectionMethod; secret: string } | null;
  /**
   * R3 - retained secrets to display persistently, keyed by method. Populated
   * when the effective `CredentialSecretVisibility` is `always`, so the
   * Connect tab can ALWAYS show the secret (re-viewable) rather than only at
   * the create moment. Rendered without the one-time "copy now" warning.
   */
  retainedSecrets?: Partial<Record<ConnectionMethod, string>> | null;
  /** Initially-selected method; defaults to the first enabled method. */
  defaultMethod?: ConnectionMethod;
  /** Optional `data-testid` root; children derive `<id>-*`. */
  'data-testid'?: string;
}

/**
 * Build the export payload (JSON / .env / download) for a method: its non-null
 * Entra fields, the one-time secret substituted in when present, and (for WIF)
 * the expected audience.
 */
function buildPayload(
  method: ConnectionEnabledMethod,
  oneTimeSecret?: { method: ConnectionMethod; secret: string } | null,
  retainedSecrets?: Partial<Record<ConnectionMethod, string>> | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  const secretValue =
    oneTimeSecret && oneTimeSecret.method === method.method
      ? oneTimeSecret.secret
      : (retainedSecrets?.[method.method] ?? null);
  for (const [key, value] of Object.entries(method.entraFields)) {
    if (value !== null && value !== undefined) {
      out[key] = value;
    } else if ((key === 'clientSecret' || key === 'secretToken') && secretValue) {
      out[key] = secretValue;
    }
  }
  if (method.expectedAudience) out.expectedAudience = method.expectedAudience;
  return out;
}

/** Render the payload as `.env` lines. */
function toEnv(payload: Record<string, string>): string {
  return Object.entries(payload)
    .map(([key, value]) => `${ENV_KEYS[key] ?? `SCIM_${key.toUpperCase()}`}=${value}`)
    .join('\n');
}

export const ConnectionPanel: React.FC<ConnectionPanelProps> = ({
  connectionInfo,
  oneTimeSecret,
  retainedSecrets,
  defaultMethod,
  'data-testid': testId = 'connection-panel',
}) => {
  const classes = useStyles();
  const { copy } = useCopyToClipboard();
  const enabled = connectionInfo.enabledMethods;

  const initial =
    defaultMethod && enabled.some((m) => m.method === defaultMethod)
      ? defaultMethod
      : (enabled[0]?.method ?? null);
  const [selected, setSelected] = useState<ConnectionMethod | null>(initial);

  if (enabled.length === 0) {
    return (
      <Card className={classes.root} data-testid={testId}>
        <Subtitle2>Connect this endpoint</Subtitle2>
        <MessageBar intent="warning" data-testid={`${testId}-no-methods`}>
          <MessageBarBody>
            No authentication method is enabled for this endpoint. Enable one in the endpoint
            Settings (Secret Token, OAuth2 client credentials, or WIF) to generate connection
            details.
          </MessageBarBody>
        </MessageBar>
      </Card>
    );
  }

  const method = enabled.find((m) => m.method === selected) ?? enabled[0];
  const payload = buildPayload(method, oneTimeSecret, retainedSecrets);
  const oneTimeForMethod =
    oneTimeSecret && oneTimeSecret.method === method.method ? oneTimeSecret.secret : null;
  const retainedForMethod = retainedSecrets?.[method.method] ?? null;
  const secretForMethod = oneTimeForMethod ?? retainedForMethod;

  const onDownload = (): void => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scim-connection-${connectionInfo.endpointId}-${method.method}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Card className={classes.root} data-testid={testId}>
      <div className={classes.header}>
        <Subtitle2>Connect this endpoint to Entra ID</Subtitle2>
        <CopyJsonButton value={payload} data-testid={`${testId}-copy-json`} label="Copy all as JSON" />
      </div>

      <div className={classes.methodRow} data-testid={`${testId}-method-selector`}>
        <Caption1>Method:</Caption1>
        <RadioGroup
          layout="horizontal"
          value={method.method}
          onChange={(_e, d) => setSelected(d.value as ConnectionMethod)}
        >
          {enabled.map((m) => (
            <Radio
              key={m.method}
              value={m.method}
              label={m.label}
              data-testid={`${testId}-method-${m.method}`}
            />
          ))}
        </RadioGroup>
      </div>

      <Text className={classes.authMethod} data-testid={`${testId}-auth-method`}>
        Authentication Method: {method.entraAuthenticationMethod}
      </Text>

      {method.authHealth && (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}
          data-testid={`${testId}-auth-health-${method.method}`}
        >
          <Badge
            appearance="filled"
            color={method.authHealth.lastOutcome === 'accept' ? 'success' : 'danger'}
            data-testid={`${testId}-auth-health-badge`}
          >
            {method.authHealth.lastOutcome === 'accept' ? 'Last auth: OK' : 'Last auth: FAILED'}
          </Badge>
          <Caption1>
            {method.authHealth.lastReasonCode ? `${method.authHealth.lastReasonCode} - ` : ''}
            {new Date(method.authHealth.lastAttemptAt).toLocaleString()}
            {method.authHealth.lastCorrelationId ? ` (req ${method.authHealth.lastCorrelationId})` : ''}
          </Caption1>
        </div>
      )}

      <Caption1 className={classes.intro} data-testid={`${testId}-intro`}>
        Labels match Microsoft Entra ID&apos;s provisioning form. For Okta, OneLogin, Ping, or a
        custom SCIM client, the per-field notes explain the equivalent value to paste.
      </Caption1>

      <div className={classes.fieldGrid} data-testid={`${testId}-fields`}>
        {Object.entries(method.entraFields).map(([key, value]) => {
          // WIF maps Entra's "Client identifier" field to the sub claim, so use
          // a WIF-specific label + description there (generic OAuth wording is
          // wrong for WIF). All other keys use the shared labels.
          const isWifSubject = method.method === 'wif' && key === 'clientIdentifier';
          const label = isWifSubject
            ? 'Client identifier (sub claim)'
            : (FIELD_LABELS[key] ?? key);
          const desc = isWifSubject
            ? 'For Workload Identity Federation: Entra\'s "Client identifier" field takes the subject (sub) claim the source IdP token must carry - i.e. the service-principal object id this endpoint expects.'
            : FIELD_DESCRIPTIONS[key];
          const isSecret = key === 'clientSecret' || key === 'secretToken';
          return (
            <div key={key} className={classes.fieldRow} data-testid={`${testId}-field-${key}`}>
              <div className={classes.labelCell}>
                <Text className={classes.fieldLabel}>{label}</Text>
                {desc && (
                  <Caption1 className={classes.fieldDesc} data-testid={`${testId}-desc-${key}`}>
                    {desc}
                  </Caption1>
                )}
              </div>
              {value !== null ? (
                <CopyableField value={value} monospace truncate data-testid={`${testId}-value-${key}`} />
              ) : isSecret && secretForMethod ? (
                <CopyableField
                  value={secretForMethod}
                  monospace
                  truncate
                  data-testid={`${testId}-value-${key}`}
                />
              ) : isSecret ? (
                <Caption1 data-testid={`${testId}-secret-placeholder`}>
                  {method.clientSecretState === 'create-required'
                    ? 'Create a credential to generate a secret'
                    : 'Shown once at creation'}
                </Caption1>
              ) : (
                <Caption1>-</Caption1>
              )}
            </div>
          );
        })}
        {method.expectedAudience && (
          <div className={classes.fieldRow} data-testid={`${testId}-field-expectedAudience`}>
            <div className={classes.labelCell}>
              <Text className={classes.fieldLabel}>{FIELD_LABELS.expectedAudience}</Text>
              <Caption1 className={classes.fieldDesc}>{FIELD_DESCRIPTIONS.expectedAudience}</Caption1>
            </div>
            <CopyableField
              value={method.expectedAudience}
              monospace
              truncate
              data-testid={`${testId}-value-expectedAudience`}
            />
          </div>
        )}
      </div>

      {oneTimeForMethod && (
        <MessageBar intent="warning" data-testid={`${testId}-secret-warning`}>
          <MessageBarBody>Copy the secret now. It will not be shown again.</MessageBarBody>
        </MessageBar>
      )}

      {!oneTimeForMethod && retainedForMethod && (
        <MessageBar intent="info" data-testid={`${testId}-secret-retained-note`}>
          <MessageBarBody>
            This secret is re-viewable because the credential secret visibility is set to Always.
          </MessageBarBody>
        </MessageBar>
      )}

      <div className={classes.actions}>
        <Button
          appearance="secondary"
          onClick={() => void copy(toEnv(payload))}
          data-testid={`${testId}-copy-env`}
        >
          Copy as .env
        </Button>
        <Button
          appearance="secondary"
          icon={<ArrowDownload16Regular />}
          onClick={onDownload}
          data-testid={`${testId}-download`}
        >
          Download .json
        </Button>
      </div>
    </Card>
  );
};
