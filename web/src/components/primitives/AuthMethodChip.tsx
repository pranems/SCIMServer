/**
 * AuthMethodChip - a single, reusable badge that renders the authentication
 * decision for a request-log / recent-activity row (X5). It centralises the
 * badge logic that was hand-rolled inline in LogsPage + LogsTab so EVERY
 * surface that shows a log/activity row renders the SAME chip:
 *
 *   - Resource CRUD request  -> "auth ok - <method>" (green) or the reject
 *     reason code (red).
 *   - Token-mint request (a POST to `/oauth/token`) -> "JWT - <method>" (green)
 *     naming the auth method that authorized the mint and the minted token type
 *     (all SCIMServer-minted tokens are JWT bearer tokens today), or the reject
 *     reason (red).
 *
 * A row with no auth decision (e.g. a health probe, or a pre-V10 row) renders a
 * muted "-".
 *
 * The chip is display-only; a stable `<data-testid>` is forwarded so specs can
 * assert presence + text without coupling to the exact label.
 */
import * as React from 'react';
import { Badge, Caption1 } from '@fluentui/react-components';

export type AuthChipOutcome = 'accept' | 'reject';

export interface AuthMethodChipProps {
  /** 'accept' | 'reject'; when absent the chip renders a muted "-". */
  outcome?: AuthChipOutcome;
  /** The winning/attempted auth method (wif | oauth_client | bearer_jwt | ...). */
  method?: string;
  /** Reason code shown when the outcome is a reject. */
  reason?: string;
  /** The request URL/path - used to detect a token-mint request. */
  url?: string;
  'data-testid'?: string;
}

/** Human-friendly labels for the internal auth-method keywords. */
const METHOD_LABELS: Record<string, string> = {
  bearer_jwt: 'OAuth JWT',
  oauth_client: 'OAuth client',
  wif: 'WIF',
  shared_secret: 'Global secret',
  endpoint_bearer: 'Endpoint bearer',
};

export function methodLabel(method: string | undefined): string {
  if (!method) return 'unknown';
  return METHOD_LABELS[method] ?? method;
}

/** A token-mint request is a POST to a `/oauth/token` endpoint. */
export function isTokenMintUrl(url: string | undefined): boolean {
  return typeof url === 'string' && url.includes('/oauth/token');
}

export const AuthMethodChip: React.FC<AuthMethodChipProps> = ({
  outcome,
  method,
  reason,
  url,
  'data-testid': dataTestId,
}) => {
  if (!outcome) {
    return <Caption1 data-testid={dataTestId}>-</Caption1>;
  }

  const tokenMint = isTokenMintUrl(url);
  const label =
    outcome === 'accept'
      ? tokenMint
        ? `JWT - ${methodLabel(method)}`
        : `auth ok - ${methodLabel(method)}`
      : (reason ?? 'auth fail');

  return (
    <Badge
      appearance="filled"
      color={outcome === 'accept' ? 'success' : 'danger'}
      title={
        outcome === 'accept'
          ? tokenMint
            ? `Minted a JWT bearer token; authorized via ${methodLabel(method)}`
            : `Authenticated via ${methodLabel(method)}`
          : (reason ?? outcome)
      }
      data-testid={dataTestId}
    >
      {label}
    </Badge>
  );
};
