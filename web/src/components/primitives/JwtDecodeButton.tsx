/**
 * JwtDecodeButton - W2. A small "Decode" affordance for an encoded JWT value
 * (a Bearer token, `client_assertion`, `access_token`, ...). Decoding is
 * client-side and non-verifying: a JWT is signed, not encrypted, so its header
 * + claims are readable by the holder. Clicking toggles an inline, copyable
 * view of the decoded header + payload (the signature is never shown, only a
 * presence note).
 *
 * Renders nothing when the value does not look like a JWT, so callers can pass
 * any value and only get the button when it is decodable.
 */
import * as React from 'react';
import { Button, Text, makeStyles, tokens } from '@fluentui/react-components';
import { decodeJwt, looksLikeJwt } from '../../utils/jwt-decode';
import { CopyJsonButton } from './CopyJsonButton';

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 },
  result: { display: 'flex', flexDirection: 'column', gap: '6px' },
  section: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
  },
  sectionLabel: {
    color: tokens.colorNeutralForeground3,
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: '12px',
  },
  pre: {
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: '12px',
    color: tokens.colorNeutralForeground1,
    backgroundColor: tokens.colorNeutralBackground2,
    padding: '6px 8px',
    borderRadius: tokens.borderRadiusSmall,
    margin: 0,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    overflowWrap: 'anywhere',
    minWidth: 0,
    maxWidth: '100%',
    boxSizing: 'border-box',
    maxHeight: '240px',
    overflowY: 'auto',
  },
  note: { color: tokens.colorNeutralForeground3, fontSize: '12px' },
});

const JsonSection: React.FC<{ label: string; value: unknown; testId: string }> = ({
  label,
  value,
  testId,
}) => {
  const classes = useStyles();
  const text = React.useMemo(() => {
    try {
      return JSON.stringify(value, null, 2) ?? 'null';
    } catch {
      return String(value);
    }
  }, [value]);
  return (
    <div className={classes.section} data-testid={testId}>
      <div className={classes.sectionHeader}>
        <span className={classes.sectionLabel}>{label}</span>
        <CopyJsonButton value={value} iconOnly ariaLabel={`Copy ${label}`} data-testid={`${testId}-copy-button`} />
      </div>
      <pre className={classes.pre} data-testid={`${testId}-pre`}>{text}</pre>
    </div>
  );
};

export interface JwtDecodeButtonProps {
  /** The (possibly JWT) value. When it does not look like a JWT, nothing renders. */
  token: unknown;
  /** Button label; default "Decode JWT". */
  label?: string;
  'data-testid'?: string;
}

export const JwtDecodeButton: React.FC<JwtDecodeButtonProps> = ({
  token,
  label = 'Decode JWT',
  'data-testid': testId = 'jwt-decode',
}) => {
  const classes = useStyles();
  const [open, setOpen] = React.useState(false);

  if (!looksLikeJwt(token)) return null;
  const decoded = open ? decodeJwt(token) : null;

  return (
    <div className={classes.root} data-testid={testId}>
      <Button
        size="small"
        appearance="subtle"
        onClick={() => setOpen((v) => !v)}
        data-testid={`${testId}-button`}
      >
        {open ? 'Hide decoded' : label}
      </Button>
      {open && decoded?.isJwt && (
        <div className={classes.result} data-testid={`${testId}-result`}>
          <JsonSection label="Header (alg / kid)" value={decoded.header} testId={`${testId}-header`} />
          <JsonSection label="Payload (claims)" value={decoded.payload} testId={`${testId}-payload`} />
          <Text className={classes.note}>
            {decoded.signaturePresent
              ? 'Signature present (not verified - a JWT is signed, not encrypted).'
              : 'No signature segment (alg=none or unsigned).'}
          </Text>
        </div>
      )}
      {open && decoded && !decoded.isJwt && (
        <Text className={classes.note} data-testid={`${testId}-invalid`}>
          Not a decodable JWT: {decoded.reason}
        </Text>
      )}
    </div>
  );
};
