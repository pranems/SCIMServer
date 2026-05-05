/**
 * AppShell + AppSidebar + AppHeader - unit tests.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AppShell } from './AppShell';
import { useUIStore } from '../store/ui-store';

// Reset Zustand store between tests
beforeEach(() => {
  useUIStore.setState({
    sidebarCollapsed: false,
    commandPaletteOpen: false,
    colorScheme: 'light',
  });
});

describe('AppShell', () => {
  it('renders header, sidebar, and content area', () => {
    render(<AppShell />);

    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    expect(screen.getByTestId('app-header')).toBeInTheDocument();
    expect(screen.getByTestId('app-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('app-content')).toBeInTheDocument();
  });

  it('renders children in content area', () => {
    render(<AppShell><div data-testid="custom-child">Custom Content</div></AppShell>);

    expect(screen.getByTestId('custom-child')).toBeInTheDocument();
    expect(screen.getByText('Custom Content')).toBeInTheDocument();
  });

  it('renders content area for pages', () => {
    render(<AppShell />);

    // Dashboard page will show loading state or content
    expect(screen.getByTestId('app-content')).toBeInTheDocument();
  });
});

describe('AppSidebar', () => {
  it('renders all 4 nav items', () => {
    render(<AppShell><div>test</div></AppShell>);

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Endpoints')).toBeInTheDocument();
    expect(screen.getByText('Logs')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('toggles collapsed state on button click', () => {
    render(<AppShell />);

    const toggle = screen.getByTestId('sidebar-toggle');
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);

    fireEvent.click(toggle);
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);
  });
});

describe('AppHeader', () => {
  it('renders SCIMServer title', () => {
    render(<AppShell />);

    expect(screen.getByText('SCIMServer')).toBeInTheDocument();
  });

  it('toggles theme on button click', () => {
    render(<AppShell />);

    const themeBtn = screen.getByTestId('theme-toggle');
    expect(useUIStore.getState().colorScheme).toBe('light');

    fireEvent.click(themeBtn);
    expect(useUIStore.getState().colorScheme).toBe('dark');
  });
});
