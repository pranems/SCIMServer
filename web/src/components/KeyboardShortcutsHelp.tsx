/**
 * KeyboardShortcutsHelp - modal listing every registered keyboard shortcut
 * (Phase F2). Opened by pressing `?` anywhere outside an input.
 */
import React from 'react';
import {
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  makeStyles,
  tokens,
  Caption1,
  Text,
} from '@fluentui/react-components';

const useStyles = makeStyles({
  surface: { maxWidth: '520px', width: '90vw' },
  groupHeading: {
    color: tokens.colorNeutralForeground3,
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    paddingTop: '12px',
    paddingBottom: '4px',
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 0',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  kbdGroup: {
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
  },
  kbd: {
    display: 'inline-block',
    padding: '2px 6px',
    fontFamily: 'monospace',
    fontSize: '12px',
    backgroundColor: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    minWidth: '20px',
    textAlign: 'center' as const,
  },
});

interface ShortcutEntry {
  keys: string[];
  description: string;
}

interface ShortcutGroup {
  heading: string;
  entries: ShortcutEntry[];
}

const SHORTCUTS: ReadonlyArray<ShortcutGroup> = [
  {
    heading: 'Navigation',
    entries: [
      { keys: ['g', 'd'], description: 'Go to Dashboard' },
      { keys: ['g', 'e'], description: 'Go to Endpoints' },
      { keys: ['g', 'm'], description: 'Go to Manual Provision' },
      { keys: ['g', 'l'], description: 'Go to Logs' },
      { keys: ['g', 's'], description: 'Go to Settings' },
    ],
  },
  {
    heading: 'Search & help',
    entries: [
      { keys: ['/'], description: 'Open command palette / search' },
      { keys: ['?'], description: 'Show this shortcuts help' },
      { keys: ['Cmd', 'K'], description: 'Open command palette (mac)' },
      { keys: ['Ctrl', 'K'], description: 'Open command palette (windows / linux)' },
      { keys: ['Esc'], description: 'Close palette / drawer / dialog' },
    ],
  },
];

export interface KeyboardShortcutsHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const KeyboardShortcutsHelp: React.FC<KeyboardShortcutsHelpProps> = ({ open, onOpenChange }) => {
  const classes = useStyles();
  return (
    <Dialog open={open} onOpenChange={(_, d) => onOpenChange(d.open)}>
      <DialogSurface className={classes.surface} aria-label="Keyboard shortcuts">
        <DialogBody>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogContent data-testid="shortcuts-help">
            <Caption1>
              Press these keys anywhere outside an input field to navigate the app.
            </Caption1>
            {SHORTCUTS.map((group) => (
              <div key={group.heading}>
                <div className={classes.groupHeading}>{group.heading}</div>
                {group.entries.map((entry) => (
                  <div key={entry.description} className={classes.row}>
                    <Text>{entry.description}</Text>
                    <span className={classes.kbdGroup}>
                      {entry.keys.map((k, i) => (
                        <span key={`${entry.description}-${i}`} className={classes.kbd}>{k}</span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};
