/**
 * AppShell - main layout container for the redesigned UI.
 *
 * Composes: Header (top) + Sidebar (left) + Content (right).
 * Wrapped in FluentProvider with light/dark theme.
 *
 * @see docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md D1
 */
import React from 'react';
import {
  FluentProvider,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lightTheme, darkTheme } from '../design/theme';
import { useUIStore } from '../store/ui-store';
import { AppHeader } from './AppHeader';
import { AppSidebar } from './AppSidebar';
import { TokenGate } from './TokenGate';
import { useSSE } from '../hooks/useSSE';
import { DashboardPage } from '../pages/DashboardPage';
import { EndpointsPage } from '../pages/EndpointsPage';
import { EndpointDetailPage } from '../pages/EndpointDetailPage';
import { LogsPage } from '../pages/LogsPage';
import { SettingsPage } from '../pages/SettingsPage';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    backgroundColor: tokens.colorNeutralBackground1,
  },
  body: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  content: {
    flex: 1,
    overflow: 'auto',
    padding: '24px',
  },
});

/** Shared QueryClient - configured with sensible defaults */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,          // 30s before refetch
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

interface AppShellProps {
  children?: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const classes = useStyles();
  const colorScheme = useUIStore((s) => s.colorScheme);

  const isDark =
    colorScheme === 'dark' ||
    (colorScheme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches);

  const theme = isDark ? darkTheme : lightTheme;

  return (
    <FluentProvider theme={theme}>
      <QueryClientProvider client={queryClient}>
        <TokenGate>
          <SSEProvider />
          <div className={classes.root} data-testid="app-shell">
            <AppHeader />
            <div className={classes.body}>
              <AppSidebar />
              <main className={classes.content} data-testid="app-content">
                {children ?? <PlaceholderDashboard />}
              </main>
            </div>
          </div>
        </TokenGate>
      </QueryClientProvider>
    </FluentProvider>
  );
};

/** Placeholder until Phase 2 dashboard page is built */
const PlaceholderDashboard: React.FC = () => {
  // Simple pathname-based routing until TanStack Router is wired with real pages
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';

  // /endpoints/:id -> EndpointDetailPage
  const endpointDetailMatch = pathname.match(/^\/endpoints\/([^/]+)/);
  if (endpointDetailMatch) {
    return <EndpointDetailPage endpointId={endpointDetailMatch[1]} />;
  }

  if (pathname === '/endpoints') {
    return <EndpointsPage />;
  }

  if (pathname === '/logs') {
    return <LogsPage />;
  }

  if (pathname === '/settings') {
    return <SettingsPage />;
  }

  return <DashboardPage />;
};

/** SSE connection provider - invalidates TanStack Query cache on SCIM events */
const SSEProvider: React.FC = () => {
  useSSE();
  return null;
};
