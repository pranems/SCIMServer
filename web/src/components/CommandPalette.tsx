/**
 * CommandPalette - Cmd+K / Ctrl+K global launcher (Phase F1).
 *
 * Built on `cmdk` (the Linear / Raycast-style headless command primitive).
 * Renders inside a Fluent UI Dialog overlay so the modal scrim, focus trap,
 * and accessible name plumbing are consistent with the rest of the chrome.
 *
 * Three source groups, each filterable via the typed query (cmdk does the
 * fuzzy match for us based on the items' text content + value attribute):
 *   1. Routes - hard-coded list mirroring the TanStack Router top-level
 *      tree (Dashboard, Endpoints, Logs, Settings, Manual Provision).
 *   2. Endpoints - dynamic, sourced from useEndpoints; selecting one
 *      navigates to the endpoint detail layout's index tab.
 *   3. Quick actions - "Create user", "Create group" route to the new
 *      manual-provision page (E3 lands these landing pages).
 *
 * Global shortcut: Cmd+K (mac) and Ctrl+K (everywhere else) listened on
 * `document` so the palette can be opened from anywhere in the app. The
 * AppShell (or any other root-level mount point) renders this once and
 * passes a controlled open state.
 *
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md S9.1 F1
 */
import React from 'react';
import { Command } from 'cmdk';
import {
  Dialog,
  DialogSurface,
  DialogBody,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { useNavigate } from '@tanstack/react-router';
import { useEndpoints } from '../api/queries';

// ─── Hook: global Cmd+K listener ────────────────────────────────────

/** Bind Cmd+K (mac) / Ctrl+K (others) to toggle the palette open. */
export function useCommandPaletteShortcut(onToggle: (open: boolean) => void): void {
  React.useEffect(() => {
    function handler(e: KeyboardEvent): void {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onToggle(true);
      }
      if (e.key === 'Escape') {
        onToggle(false);
      }
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onToggle]);
}

// ─── Static route registry ──────────────────────────────────────────

interface RouteEntry {
  label: string;
  to: string;
}

const ROUTES: ReadonlyArray<RouteEntry> = [
  { label: 'Go to Dashboard', to: '/' },
  { label: 'Go to Endpoints', to: '/endpoints' },
  { label: 'Go to Manual Provision', to: '/manual-provision' },
  { label: 'Go to Logs', to: '/logs' },
  { label: 'Go to Settings', to: '/settings' },
];

// ─── Styles ────────────────────────────────────────────────────────

const useStyles = makeStyles({
  surface: {
    maxWidth: '560px',
    width: '90vw',
    padding: 0,
  },
  body: { padding: 0 },
  cmd: {
    display: 'flex',
    flexDirection: 'column',
  },
  input: {
    width: '100%',
    border: 'none',
    outline: 'none',
    padding: '14px 16px',
    fontSize: '15px',
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  list: {
    maxHeight: '400px',
    overflowY: 'auto',
    padding: '8px',
  },
  groupHeading: {
    color: tokens.colorNeutralForeground3,
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    padding: '8px 8px 4px 8px',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 10px',
    borderRadius: tokens.borderRadiusMedium,
    cursor: 'pointer',
    fontSize: '14px',
    color: tokens.colorNeutralForeground1,
    '&[data-selected="true"]': {
      backgroundColor: tokens.colorNeutralBackground1Selected,
    },
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  empty: {
    padding: '16px',
    color: tokens.colorNeutralForeground3,
    textAlign: 'center' as const,
    fontSize: '13px',
  },
  hint: {
    padding: '8px 16px',
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground3,
    fontSize: '11px',
  },
});

// ─── Component ─────────────────────────────────────────────────────

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onOpenChange }) => {
  const classes = useStyles();
  const navigate = useNavigate();
  const { data } = useEndpoints();
  const endpoints = data?.endpoints ?? [];

  // Cmd+K / Esc are listened globally so the palette is reachable from
  // anywhere - including pages that don't otherwise focus an input.
  useCommandPaletteShortcut(onOpenChange);

  function close(): void {
    onOpenChange(false);
  }

  function goRoute(to: string): void {
    navigate({ to: to as never });
    close();
  }

  function goEndpoint(id: string): void {
    navigate({
      to: '/endpoints/$endpointId' as never,
      params: { endpointId: id } as never,
    });
    close();
  }

  function goManualProvision(): void {
    navigate({ to: '/manual-provision' as never });
    close();
  }

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(_, d) => onOpenChange(d.open)}>
      <DialogSurface className={classes.surface} aria-label="Command palette">
        <DialogBody className={classes.body}>
          <Command className={classes.cmd} data-testid="command-palette" label="Command palette">
            <Command.Input
              autoFocus
              placeholder="Type a command or search..."
              className={classes.input}
            />
            <Command.List className={classes.list}>
              <Command.Empty className={classes.empty}>No matches.</Command.Empty>

              <Command.Group heading="Routes" className={classes.groupHeading}>
                {ROUTES.map((r) => (
                  <Command.Item
                    key={r.to}
                    value={r.label}
                    className={classes.item}
                    onSelect={() => goRoute(r.to)}
                  >
                    {r.label}
                  </Command.Item>
                ))}
              </Command.Group>

              {endpoints.length > 0 && (
                <Command.Group heading="Endpoints" className={classes.groupHeading}>
                  {endpoints.map((ep) => {
                    const label = ep.displayName ?? ep.name;
                    return (
                      <Command.Item
                        key={ep.id}
                        value={`endpoint ${label} ${ep.id}`}
                        className={classes.item}
                        onSelect={() => goEndpoint(ep.id)}
                      >
                        {label}
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              )}

              <Command.Group heading="Quick actions" className={classes.groupHeading}>
                <Command.Item
                  value="Create user"
                  className={classes.item}
                  onSelect={goManualProvision}
                >
                  Create user
                </Command.Item>
                <Command.Item
                  value="Create group"
                  className={classes.item}
                  onSelect={goManualProvision}
                >
                  Create group
                </Command.Item>
              </Command.Group>
            </Command.List>
            <div className={classes.hint}>
              <kbd>Cmd+K</kbd> / <kbd>Ctrl+K</kbd> opens, <kbd>Esc</kbd> closes,
              <kbd>Up</kbd> / <kbd>Down</kbd> navigates, <kbd>Enter</kbd> selects.
            </div>
          </Command>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};
