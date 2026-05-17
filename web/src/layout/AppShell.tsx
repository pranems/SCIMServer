/**
 * AppShell - main layout container for the redesigned UI.
 *
 * Composes: Header (top) + Sidebar (left) + Content (right). Wrapped in
 * FluentProvider with light/dark theme, TanStack QueryClientProvider, and
 * TokenGate. Content area renders whatever children the caller passes -
 * in production this is the TanStack Router <Outlet /> from __root.tsx.
 *
 * Phase A2 (cutover): the legacy AppRouter regex matcher has been removed.
 * URL is the single source of truth for view state, driven by the
 * <RouterProvider /> mounted in App.tsx and rendered into this shell via
 * the root route's <AppShell><Outlet /></AppShell> composition.
 *
 * @see docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md D1
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md Phase A2
 */
import React from 'react';
import {
  FluentProvider,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { QueryClientProvider } from '@tanstack/react-query';
import { lightTheme, darkTheme } from '../design/theme';
import { useUIStore } from '../store/ui-store';
import { AppHeader } from './AppHeader';
import { AppSidebar } from './AppSidebar';
import { CommandPalette } from '../components/CommandPalette';
import { KeyboardShortcutsHelp } from '../components/KeyboardShortcutsHelp';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useNavigate } from '@tanstack/react-router';
import { TokenGate } from './TokenGate';
import { useSSE } from '../hooks/useSSE';
import { LogStreamDrawer } from './LogStreamDrawer';
import { NotificationsDrawer } from './NotificationsDrawer';
import { OnboardingWizard } from './OnboardingWizard';
import { queryClient } from '../api/query-client';

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

/**
 * Shared QueryClient is now a module-level singleton in api/query-client
 * so route loaders (web/src/router.ts) can pre-fetch into the same
 * cache instance the components read via useQuery.
 */

interface AppShellProps {
  children?: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const classes = useStyles();
  const colorScheme = useUIStore((s) => s.colorScheme);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const navigate = useNavigate();

  // Phase F2 keyboard shortcuts: g d/e/m/l/s navigate; / opens the
  // command palette (which doubles as global search); ? opens the
  // shortcuts help modal.
  useKeyboardShortcuts({
    onNavigate: (to) => navigate({ to: to as never }),
    onFocusSearch: () => setPaletteOpen(true),
    onShowHelp: () => setHelpOpen(true),
  });

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
          <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
          <KeyboardShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} />
          <LogStreamDrawer />
          <NotificationsDrawer />
          <OnboardingWizard />
          <div className={classes.root} data-testid="app-shell">
            <AppHeader />
            <div className={classes.body}>
              <AppSidebar />
              <main className={classes.content} data-testid="app-content">
                {children}
              </main>
            </div>
          </div>
        </TokenGate>
      </QueryClientProvider>
    </FluentProvider>
  );
};

/** SSE connection provider - invalidates TanStack Query cache on SCIM events */
const SSEProvider: React.FC = () => {
  useSSE();
  return null;
};
