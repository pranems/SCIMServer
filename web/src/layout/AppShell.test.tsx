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
import { screen, fireEvent, waitFor } from '@testing-library/react';
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
});

// ─── Phase N7 - denseMode wire to documentElement[data-density] ──────

import { usePreferencesStore } from '../store/preferences-store';

describe('AppShell - N7 denseMode wire', () => {
  beforeEach(() => {
    setStoredToken('test-token');
    usePreferencesStore.getState().resetPreferences();
    document.documentElement.removeAttribute('data-density');
  });

  it('sets data-density="dense" on documentElement when denseMode=true', async () => {
    usePreferencesStore.getState().setDenseMode(true);
    await renderShell();
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-density')).toBe('dense'),
    );
  });

  it('removes data-density attribute when denseMode=false', async () => {
    usePreferencesStore.getState().setDenseMode(true);
    document.documentElement.setAttribute('data-density', 'dense');
    usePreferencesStore.getState().setDenseMode(false);
    await renderShell();
    await waitFor(() =>
      expect(document.documentElement.hasAttribute('data-density')).toBe(false),
    );
  });
});

