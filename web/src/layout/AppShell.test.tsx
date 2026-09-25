/**
 * AppShell + AppSidebar + AppHeader - unit tests.
 *
 * Phase A2 cutover: AppSidebar now uses TanStack Router primitives
 * (useRouterState, <Link>) so every render must happen inside a router
 * context. The renderWithRouter helper mounts the supplied UI as the
 * route component of an in-memory router so all hooks resolve.
 */
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, fireEvent, render, waitFor } from '@testing-library/react';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { AppShell } from './AppShell';
import { useUIStore } from '../store/ui-store';
import { setStoredToken } from '../auth/token';
import { renderWithRouter } from '../test/router-test-utils';

// Reset Zustand store + set auth token between tests.
beforeEach(() => {
  setStoredToken('test-token');
  useUIStore.setState({
    sidebarCollapsed: false,
    commandPaletteOpen: false,
    colorScheme: 'light',
  });
});

async function renderShell(child?: React.ReactNode) {
  const result = renderWithRouter(<AppShell>{child}</AppShell>, { initialUrl: '/' });
  // RouterProvider resolves the initial route asynchronously.
  await screen.findByTestId('app-shell');
  return result;
}

async function renderPersistentShell() {
  const rootRoute = createRootRoute({
    component: () => <AppShell><Outlet /></AppShell>,
  });
  const dashboardRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <div data-testid="history-dashboard">Dashboard</div>,
  });
  const endpointsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/endpoints',
    component: () => <div data-testid="history-endpoints">Endpoints</div>,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings',
    component: () => <div data-testid="history-settings">Settings</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([dashboardRoute, endpointsRoute, settingsRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });

  const result = render(<RouterProvider router={router} />);
  await screen.findByTestId('app-shell');
  return { ...result, router };
}

describe('AppShell', () => {
  it('renders header, sidebar, and content area', async () => {
    await renderShell();

    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    expect(screen.getByTestId('app-header')).toBeInTheDocument();
    expect(screen.getByTestId('app-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('app-content')).toBeInTheDocument();
  });

  it('renders children in content area', async () => {
    await renderShell(<div data-testid="custom-child">Custom Content</div>);

    expect(screen.getByTestId('custom-child')).toBeInTheDocument();
    expect(screen.getByText('Custom Content')).toBeInTheDocument();
  });

  it('renders content area for pages', async () => {
    await renderShell();

    // Content area is always present even with no children.
    expect(screen.getByTestId('app-content')).toBeInTheDocument();
  });
});

describe('AppSidebar', () => {
  it('renders all 4 nav items', async () => {
    await renderShell(<div>test</div>);

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Endpoints')).toBeInTheDocument();
    expect(screen.getByText('Logs')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('toggles collapsed state on button click', async () => {
    await renderShell();

    const toggle = screen.getByTestId('sidebar-toggle');
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);

    fireEvent.click(toggle);
    await waitFor(() => expect(useUIStore.getState().sidebarCollapsed).toBe(true));
  });

  it('exposes router-aware <Link> nav items', async () => {
    await renderShell();

    const dashLink = screen.getByTestId('nav-dashboard');
    const endpointsLink = screen.getByTestId('nav-endpoints');
    expect(dashLink).toHaveAttribute('href', '/');
    expect(endpointsLink).toHaveAttribute('href', '/endpoints');
  });
});

describe('AppHeader', () => {
  it('renders SCIMServer title', async () => {
    await renderShell();

    expect(screen.getByText('SCIMServer')).toBeInTheDocument();
  });

  it('toggles theme on button click', async () => {
    await renderShell();

    const themeBtn = screen.getByTestId('theme-toggle');
    expect(useUIStore.getState().colorScheme).toBe('light');

    fireEvent.click(themeBtn);
    await waitFor(() => expect(useUIStore.getState().colorScheme).toBe('dark'));
  });

  it('provides global Back and Forward across route transitions', async () => {
    const { router } = await renderPersistentShell();

    expect(screen.getByTestId('global-history-back')).toBeDisabled();
    expect(screen.getByTestId('global-history-forward')).toBeDisabled();

    fireEvent.click(screen.getByTestId('nav-endpoints'));
    await waitFor(() => {
      expect(router.history.location.pathname).toBe('/endpoints');
      expect(screen.getByTestId('global-history-back')).not.toBeDisabled();
    });
    expect(screen.getByTestId('global-history-forward')).toBeDisabled();

    fireEvent.click(screen.getByTestId('global-history-back'));
    await waitFor(() => {
      expect(router.history.location.pathname).toBe('/');
      expect(screen.getByTestId('global-history-forward')).not.toBeDisabled();
    });

    fireEvent.click(screen.getByTestId('global-history-forward'));
    await waitFor(() => {
      expect(router.history.location.pathname).toBe('/endpoints');
      expect(screen.getByTestId('global-history-forward')).toBeDisabled();
    });
  });

  it('discards the stale Forward branch after Back followed by a new PUSH', async () => {
    const { router } = await renderPersistentShell();

    fireEvent.click(screen.getByTestId('nav-endpoints'));
    await waitFor(() => expect(router.history.location.pathname).toBe('/endpoints'));
    fireEvent.click(screen.getByTestId('global-history-back'));
    await waitFor(() => expect(router.history.location.pathname).toBe('/'));
    expect(screen.getByTestId('global-history-forward')).not.toBeDisabled();

    fireEvent.click(screen.getByTestId('nav-settings'));
    await waitFor(() => expect(router.history.location.pathname).toBe('/settings'));
    expect(screen.getByTestId('global-history-forward')).toBeDisabled();

    fireEvent.click(screen.getByTestId('global-history-forward'));
    expect(router.history.location.pathname).toBe('/settings');
  });
});

// Phase N7 denseMode wire to documentElement[data-density] was rolled
// back in the 2026-05-27 partial-rollback commit alongside the matching
// AppShell.tsx effect removal. The N7 test suite below was deleted to
// keep production code and tests consistent. See
// docs/UNFINISHED_PHASE_N_HANDOFF_2026-05-27.md for the restore plan
// when N7 wiring resumes.

