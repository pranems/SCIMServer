/**
 * AppHeader - top navigation bar with title, theme toggle.
 */
import React from 'react';
import {
  makeStyles,
  tokens,
  Text,
  Button,
  Tooltip,
} from '@fluentui/react-components';
import {
  WeatherMoon24Regular,
  WeatherSunny24Regular,
  Key24Regular,
} from '@fluentui/react-icons';
import { HEADER_HEIGHT } from '../design/tokens';
import { useUIStore } from '../store/ui-store';
import { clearStoredToken, notifyTokenInvalid } from '../auth/token';

const useStyles = makeStyles({
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: HEADER_HEIGHT,
    padding: '0 16px',
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    flexShrink: 0,
  },
  titleArea: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
});

export const AppHeader: React.FC = () => {
  const classes = useStyles();
  const colorScheme = useUIStore((s) => s.colorScheme);
  const setColorScheme = useUIStore((s) => s.setColorScheme);

  const isDark = colorScheme === 'dark' || (colorScheme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);

  return (
    <header className={classes.header} data-testid="app-header">
      <div className={classes.titleArea}>
        <Text size={500} weight="semibold" style={{ color: 'inherit' }}>
          SCIMServer
        </Text>
      </div>

      <div className={classes.actions}>
        <Tooltip content="Change token" relationship="label">
          <Button
            appearance="subtle"
            icon={<Key24Regular />}
            onClick={() => { clearStoredToken(); notifyTokenInvalid(); }}
            aria-label="Change token"
            data-testid="change-token"
            style={{ color: 'inherit' }}
          />
        </Tooltip>
        <Tooltip
          content={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          relationship="label"
        >
          <Button
            appearance="subtle"
            icon={isDark ? <WeatherSunny24Regular /> : <WeatherMoon24Regular />}
            onClick={() => setColorScheme(isDark ? 'light' : 'dark')}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            data-testid="theme-toggle"
            style={{ color: 'inherit' }}
          />
        </Tooltip>
      </div>
    </header>
  );
};
