/**
 * SettingsJsonExport - a small actions row that lets an operator take a
 * settings object away as JSON: "Copy as JSON" (via the shared
 * CopyJsonButton) + "Download .json". Used on the per-endpoint Settings tab
 * and the SCIMServer admin Settings page.
 *
 * The exported shape is caller-supplied so it can be exactly the form the
 * operator needs - e.g. the `{ profile: { settings: {...} } }` PATCH-body
 * shape that can be pasted straight back into an API request, saved as a
 * backup, or diffed against an earlier capture.
 *
 * Testids: `<id>-copy` (the copy button) + `<id>-download` (the download
 * button). The download filename defaults to `settings.json`.
 */
import * as React from 'react';
import { Button, makeStyles, tokens } from '@fluentui/react-components';
import { ArrowDownload16Regular } from '@fluentui/react-icons';
import { CopyJsonButton } from './CopyJsonButton';

const useStyles = makeStyles({
  row: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  button: {
    minWidth: 'auto',
    height: '24px',
    padding: '0 8px',
    gap: '4px',
  },
  hint: { color: tokens.colorNeutralForeground3 },
});

export interface SettingsJsonExportProps {
  /** The object to export. Serialised with 2-space indent. */
  value: unknown;
  /** Download filename. Default "settings.json". */
  filename?: string;
  /** Copy button label. Default "Copy as JSON". */
  copyLabel?: string;
  /** Optional `data-testid` root; children derive `<id>-copy` + `<id>-download`. */
  'data-testid'?: string;
}

export const SettingsJsonExport: React.FC<SettingsJsonExportProps> = ({
  value,
  filename = 'settings.json',
  copyLabel = 'Copy as JSON',
  'data-testid': testId = 'settings-json-export',
}) => {
  const classes = useStyles();

  const onDownload = (): void => {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className={classes.row} data-testid={testId}>
      <CopyJsonButton value={value} label={copyLabel} data-testid={`${testId}-copy`} />
      <Button
        appearance="subtle"
        size="small"
        icon={<ArrowDownload16Regular />}
        className={classes.button}
        onClick={onDownload}
        data-testid={`${testId}-download`}
      >
        Download .json
      </Button>
    </div>
  );
};
