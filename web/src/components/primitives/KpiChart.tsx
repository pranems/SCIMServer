/**
 * KpiChart - tiny inline area/sparkline chart for KPI cards.
 *
 * Wraps `recharts` (already a runtime dependency) so the dashboard's
 * future KPI cards can show a 7-day or 24-hour trend behind the
 * headline number. The wrapper handles:
 *   - Empty / single-point input (renders an explicit fallback rather
 *     than a 0-px-wide chart that looks like a render bug)
 *   - Color tokens from Fluent UI's `tokens.colorBrandStroke1` so the
 *     chart matches the active theme without requiring per-call CSS
 *
 * Phase C4 ships only the data renderer; the dashboard composition
 * lands in Phase D4.
 *
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md Phase C4
 */
import React from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Caption1, makeStyles, tokens } from '@fluentui/react-components';

const useStyles = makeStyles({
  root: {
    width: '100%',
    height: '100%',
    minHeight: '40px',
    minWidth: '60px',
  },
  empty: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '40px',
    color: tokens.colorNeutralForeground3,
  },
});

export interface KpiChartProps {
  /** Numeric series. Length 0 or 1 renders the empty fallback. */
  data: number[];
  /** Accessible label for the chart (read by screen readers). */
  label: string;
  /**
   * Brand color theme. `accent` = blue (default), `success` = green,
   * `warning` = amber, `danger` = red. Maps to Fluent UI tokens so dark
   * mode automatically adjusts.
   */
  colorScheme?: 'accent' | 'success' | 'warning' | 'danger';
  /** Override the default test id. */
  'data-testid'?: string;
}

const COLOR_TOKENS: Record<NonNullable<KpiChartProps['colorScheme']>, string> = {
  accent: tokens.colorBrandStroke1,
  success: tokens.colorPaletteGreenForeground1,
  warning: tokens.colorPaletteYellowForeground1,
  danger: tokens.colorPaletteRedForeground1,
};

export const KpiChart: React.FC<KpiChartProps> = ({
  data,
  label,
  colorScheme = 'accent',
  ...rest
}) => {
  const classes = useStyles();
  const testId = rest['data-testid'] ?? 'kpi-chart';

  // recharts treats single-point arrays as a vertical line; render an
  // explicit "no trend" message so users know it's a real empty state.
  if (!data || data.length < 2) {
    return (
      <div
        className={classes.empty}
        role="img"
        aria-label={`${label} (no trend data yet)`}
        data-testid={`${testId}-empty`}
      >
        <Caption1>No trend data yet</Caption1>
      </div>
    );
  }

  const chartData = data.map((value, index) => ({ index, value }));
  const stroke = COLOR_TOKENS[colorScheme];

  return (
    <div className={classes.root} role="img" aria-label={label} data-testid={testId}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <defs>
            <linearGradient id={`${testId}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.4} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <Tooltip
            cursor={{ stroke, strokeWidth: 1, strokeOpacity: 0.4 }}
            contentStyle={{
              background: tokens.colorNeutralBackground1,
              border: `1px solid ${tokens.colorNeutralStroke2}`,
              borderRadius: tokens.borderRadiusMedium,
              fontSize: '12px',
              padding: '4px 8px',
            }}
            labelFormatter={(value) => `Point ${Number(value) + 1}`}
            formatter={(value) => [value as number, label]}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={stroke}
            strokeWidth={2}
            fill={`url(#${testId}-fill)`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
