/**
 * LogStreamDrawer - Phase K4 floating right-side log tail viewer.
 *
 * The grafana-loki-tail experience inside the admin UI:
 *   - Mounts via Fluent UI OverlayDrawer (right-anchored, modal=false
 *     so the operator can keep using the rest of the UI while it is
 *     open).
 *   - Reads from useLogStream (Phase K4 hook) - opens its own
 *     EventSource only while the drawer is mounted, so a closed
 *     drawer does not waste a connection.
 *   - Toolbar: connection-state badge, level filter (DEBUG/INFO/WARN/
 *     ERROR), search SearchBox, Pause/Resume button, Clear button,
 *     close button.
 *   - Body: monospace one-line-per-entry list, color-coded by level,
 *     auto-scroll-to-bottom behavior, capped at 5,000 entries (banner
 *     when at cap).
 *
 * Filter state (level + search) lives in ui-store so the operator's
 * choice persists across drawer close/open within a single session.
 *
 * @see docs/PHASE_K4_LIVE_LOG_STREAM_VIEWER.md
 */
import React from 'react';
import {
  Badge,
  Button,
  Caption1,
  Combobox,
  Option,
  OverlayDrawer,
  SearchBox,
  Subtitle1,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  Delete16Regular,
  Dismiss20Regular,
  Pause16Regular,
  Play16Regular,
} from '@fluentui/react-icons';
import {
  filterEntries,
  useLogStream,
  type LogStreamEntry,
  type LogStreamLevel,
} from '../hooks/useLogStream';
import { useUIStore } from '../store/ui-store';

const MAX_ENTRIES = 5_000;

const useStyles = makeStyles({
  drawer: {
    width: '560px',
    maxWidth: '90vw',
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '12px 16px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
  },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    alignItems: 'center',
  },
  search: {
    flex: 1,
    minWidth: '160px',
  },
  list: {
    flex: 1,
    overflow: 'auto',
    padding: '4px 0',
    backgroundColor: tokens.colorNeutralBackground3,
    fontFamily: 'monospace',
    fontSize: '11px',
    lineHeight: '1.4',
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '60px 56px 90px 1fr',
    gap: '8px',
    padding: '2px 12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    overflow: 'hidden',
  },
  empty: {
    padding: '24px 16px',
    color: tokens.colorNeutralForeground2,
    textAlign: 'center' as const,
  },
  capBanner: {
    backgroundColor: tokens.colorPaletteYellowBackground2,
    color: tokens.colorPaletteYellowForeground1,
    padding: '6px 12px',
    fontSize: '11px',
  },
  msg: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
});

const LEVEL_COLORS: Record<string, string> = {
  DEBUG: tokens.colorNeutralForeground3,
  INFO: tokens.colorPaletteBlueForeground2,
  WARN: tokens.colorPaletteYellowForeground1,
  ERROR: tokens.colorPaletteRedForeground1,
};

function levelColor(level: string): string {
  return LEVEL_COLORS[level] ?? tokens.colorNeutralForeground2;
}

function timeOnly(iso: string): string {
  // Show hh:mm:ss.SSS - the operator already knows the date.
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(11, 23);
  return date.toISOString().slice(11, 23);
}

export const LogStreamDrawer: React.FC = () => {
  const classes = useStyles();
  const open = useUIStore((s) => s.logStreamDrawerOpen);
  const setOpen = useUIStore((s) => s.setLogStreamDrawerOpen);
  const level = useUIStore((s) => s.logStreamLevel);
  const setLevel = useUIStore((s) => s.setLogStreamLevel);
  const search = useUIStore((s) => s.logStreamSearch);
  const setSearch = useUIStore((s) => s.setLogStreamSearch);

  const { entries, connectionState, paused, setPaused, clear } = useLogStream({
    enabled: open,
    maxEntries: MAX_ENTRIES,
  });

  const visible = React.useMemo(
    () => filterEntries(entries, { level, search }),
    [entries, level, search],
  );

  // Auto-scroll to bottom on new entries (when not paused). Only when
  // the operator has not manually scrolled away (within ~50 px of
  // bottom). This is the standard tail-f UX.
  const listRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (paused) return;
    const el = listRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 50) {
      el.scrollTop = el.scrollHeight;
    }
  }, [visible.length, paused]);

  if (!open) return null;

  const atCap = entries.length >= MAX_ENTRIES;

  return (
    <OverlayDrawer
      open={open}
      onOpenChange={(_, data) => setOpen(data.open)}
      position="end"
      size="medium"
      modalType="non-modal"
      data-testid="log-stream-drawer"
      className={classes.drawer}
    >
      <div className={classes.header}>
        <div className={classes.headerRow}>
          <Subtitle1>Live log stream</Subtitle1>
          <Button
            appearance="subtle"
            icon={<Dismiss20Regular />}
            aria-label="Close log stream"
            data-testid="log-stream-close"
            onClick={() => setOpen(false)}
          />
        </div>
        <div className={classes.headerRow}>
          <Badge
            appearance="outline"
            color={connectionState === 'open' ? 'success' : connectionState === 'reconnecting' ? 'warning' : 'subtle'}
            data-testid="log-stream-connection"
          >
            {connectionState}
          </Badge>
          <Caption1>
            {visible.length} of {entries.length} entries
            {atCap ? ' (buffer at cap)' : ''}
          </Caption1>
        </div>
        <div className={classes.toolbar}>
          <Combobox
            aria-label="Minimum log level"
            value={level}
            selectedOptions={[level]}
            onOptionSelect={(_, d) => {
              if (d.optionValue) setLevel(d.optionValue as LogStreamLevel);
            }}
            data-testid="log-stream-level"
          >
            <Option value="DEBUG">DEBUG</Option>
            <Option value="INFO">INFO</Option>
            <Option value="WARN">WARN</Option>
            <Option value="ERROR">ERROR</Option>
          </Combobox>
          <SearchBox
            className={classes.search}
            placeholder="Search message / path / category / requestId"
            value={search}
            onChange={(_, d) => setSearch(d.value)}
            data-testid="log-stream-search"
          />
          <Button
            appearance="subtle"
            icon={paused ? <Play16Regular /> : <Pause16Regular />}
            onClick={() => setPaused(!paused)}
            data-testid="log-stream-pause"
          >
            {paused ? 'Resume' : 'Pause'}
          </Button>
          <Button
            appearance="subtle"
            icon={<Delete16Regular />}
            onClick={() => clear()}
            data-testid="log-stream-clear"
          >
            Clear
          </Button>
        </div>
      </div>
      {atCap ? (
        <div className={classes.capBanner} data-testid="log-stream-cap-banner">
          Buffer reached cap of {MAX_ENTRIES} entries. Older entries dropped.
        </div>
      ) : null}
      <div className={classes.list} ref={listRef}>
        {visible.length === 0 ? (
          <div className={classes.empty} data-testid="log-stream-empty">
            {entries.length === 0
              ? 'Waiting for log entries...'
              : 'No entries match the current filters.'}
          </div>
        ) : (
          visible.map((entry, idx) => (
            <LogRow key={`${entry.timestamp}-${idx}`} entry={entry} testIndex={idx} />
          ))
        )}
      </div>
    </OverlayDrawer>
  );
};

interface LogRowProps {
  entry: LogStreamEntry;
  testIndex: number;
}

const LogRow: React.FC<LogRowProps> = ({ entry, testIndex }) => {
  const classes = useStyles();
  return (
    <div className={classes.row} data-testid={`log-stream-row-${testIndex}`}>
      <Text size={100}>{timeOnly(entry.timestamp)}</Text>
      <Text size={100} weight="semibold" style={{ color: levelColor(entry.level) }}>
        {entry.level}
      </Text>
      <Text size={100}>{entry.category}</Text>
      <Text size={100} className={classes.msg} title={entry.message}>
        {entry.method ? `${entry.method} ` : ''}
        {entry.path ? `${entry.path} ` : ''}
        {entry.message}
      </Text>
    </div>
  );
};
