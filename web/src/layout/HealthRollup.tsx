/**
 * HealthRollup - Phase K2 service-health traffic-light header widget.
 *
 * Renders a colored circle in the AppHeader (green / yellow / red /
 * grey) with the overall rollup state, plus an on-click popover
 * listing the 5 substatuses with per-row icons + detail lines.
 *
 * Compositional contract:
 *   - Reads everything from `useHealthRollup`. No fetch logic here.
 *   - Mounts inside AppHeader (Phase K2 wiring); re-styled with
 *     `color: 'inherit'` so it reads correctly on the brand-colored
 *     header background.
 *   - Accessible name on the trigger button always includes the
 *     overall status keyword for screen-reader disambiguation.
 *
 * @see docs/PHASE_K2_SERVICE_HEALTH_ROLLUP.md
 */
import React from 'react';
import {
  Button,
  makeStyles,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Text,
  tokens,
  Tooltip,
} from '@fluentui/react-components';
import {
  CheckmarkCircle20Filled,
  ErrorCircle20Filled,
  QuestionCircle20Filled,
  Warning20Filled,
} from '@fluentui/react-icons';
import {
  useHealthRollup,
  type HealthRollupResult,
  type HealthRollupStatus,
  type HealthSubStatus,
  type HealthSubStatusValue,
} from '../hooks/useHealthRollup';

const useStyles = makeStyles({
  trigger: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    color: 'inherit',
  },
  popover: {
    minWidth: '280px',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: '8px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  headerStatus: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '20px 1fr auto',
    columnGap: '8px',
    alignItems: 'center',
  },
  detail: {
    color: tokens.colorNeutralForeground2,
    gridColumn: '2 / span 2',
    fontSize: '12px',
  },
  rowState: {
    textTransform: 'capitalize',
  },
});

function statusIcon(value: HealthSubStatusValue | HealthRollupStatus): React.ReactElement {
  switch (value) {
    case 'healthy':
      return <CheckmarkCircle20Filled style={{ color: tokens.colorPaletteGreenForeground1 }} aria-hidden />;
    case 'degraded':
      return <Warning20Filled style={{ color: tokens.colorPaletteYellowForeground1 }} aria-hidden />;
    case 'down':
      return <ErrorCircle20Filled style={{ color: tokens.colorPaletteRedForeground1 }} aria-hidden />;
    case 'unknown':
    default:
      return <QuestionCircle20Filled style={{ color: tokens.colorNeutralForeground2 }} aria-hidden />;
  }
}

function statusLabel(value: HealthRollupStatus): string {
  switch (value) {
    case 'healthy': return 'Healthy';
    case 'degraded': return 'Degraded';
    case 'down': return 'Down';
    case 'unknown': default: return 'Unknown';
  }
}

interface HealthRollupProps {
  /** Test seam: inject a rollup result instead of calling the hook. */
  rollup?: HealthRollupResult;
}

export const HealthRollup: React.FC<HealthRollupProps> = ({ rollup: injected }) => {
  const classes = useStyles();
  const computed = useHealthRollup();
  const rollup = injected ?? computed;
  const overallLabel = statusLabel(rollup.status);
  const triggerAriaLabel = `System status: ${overallLabel}`;

  return (
    <Popover positioning="below-end" withArrow>
      <PopoverTrigger disableButtonEnhancement>
        <Tooltip content={triggerAriaLabel} relationship="label">
          <Button
            appearance="subtle"
            className={classes.trigger}
            data-testid="health-rollup-trigger"
            aria-label={triggerAriaLabel}
          >
            {statusIcon(rollup.status)}
          </Button>
        </Tooltip>
      </PopoverTrigger>
      <PopoverSurface data-testid="health-rollup-popover" className={classes.popover}>
        <div className={classes.header}>
          <Text weight="semibold">System status</Text>
          <span className={classes.headerStatus}>
            {statusIcon(rollup.status)}
            <Text size={300}>{overallLabel}</Text>
          </span>
        </div>
        <div className={classes.list}>
          {rollup.subStatuses.map((sub) => (
            <SubStatusRow key={sub.name} sub={sub} />
          ))}
        </div>
      </PopoverSurface>
    </Popover>
  );
};

const SubStatusRow: React.FC<{ sub: HealthSubStatus }> = ({ sub }) => {
  const classes = useStyles();
  return (
    <div className={classes.row} data-testid={`health-row-${sub.name}`}>
      {statusIcon(sub.status)}
      <Text weight="semibold">{sub.name}</Text>
      <Text size={200} className={classes.rowState} aria-label={`status ${sub.status}`}>
        {sub.status}
      </Text>
      <Text className={classes.detail}>{sub.detail}</Text>
    </div>
  );
};
