/**
 * App.test.tsx - Phase I1 + I2 contract test for the post-cutover
 * App entry point.
 *
 * After Phase I2 deleted the entire legacy tab-based UI tree, the
 * App component is a ~10 LoC wrapper around `<RouterProvider />`.
 * This test verifies the new contract:
 *   1. App imports + renders without throwing
 *   2. The legacy `?ui=legacy` query-param escape hatch is gone
 *   3. The legacy AuthProvider / ThemeProvider context wrappers are gone
 *
 * The old App.test.tsx (210 LoC) tested the legacy AppContent's tab
 * state machine + token modal + version polling. All of that behavior
 * lives in the redesigned shell now and is covered by the AppShell /
 * TokenGate / SettingsPage tests. Keeping a separate App test for
 * the tab UI would just be testing dead code.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Mock the RouterProvider so the test does not need a fully-bootstrapped
// router (the router itself is tested in router.test.ts + the per-route
// tests in pages/). This isolates "does App render?" from "does the
// router work?".
vi.mock('@tanstack/react-router', () => ({
  RouterProvider: ({ router }: { router: unknown }) => (
    <div data-testid="router-provider" data-router={typeof router}>
      router-provider-rendered
    </div>
  ),
}));

vi.mock('./router', () => ({
  router: { __routerStub: true },
}));

import { App } from './App';

/**
 * Strip JS/TS comments from a source string so negative assertions
 * about "code does not contain X" do not match docstring references
 * to the very thing we are saying is gone. Handles both single-line
 * and block comments. Does not handle comments inside string literals
 * (which we do not produce in App.tsx anyway).
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

describe('Phase I1 + I2 - App entry point post-cutover', () => {
  it('renders <RouterProvider /> without throwing', () => {
    const { getByTestId } = render(<App />);
    expect(getByTestId('router-provider')).toBeInTheDocument();
  });

  it('passes the router instance from ./router to RouterProvider', () => {
    const { getByTestId } = render(<App />);
    expect(getByTestId('router-provider').getAttribute('data-router')).toBe('object');
  });

  it('App.tsx code (excluding comments) no longer references the legacy ?ui=legacy escape hatch', () => {
    const code = stripComments(fs.readFileSync(path.resolve(__dirname, 'App.tsx'), 'utf-8'));
    expect(code).not.toMatch(/ui=legacy/);
    expect(code).not.toMatch(/window\.location\.search/);
    expect(code).not.toMatch(/URLSearchParams/);
  });

  it('App.tsx code (excluding comments) no longer imports AuthProvider / ThemeProvider', () => {
    const code = stripComments(fs.readFileSync(path.resolve(__dirname, 'App.tsx'), 'utf-8'));
    expect(code).not.toMatch(/from\s+['"]\.\/hooks\/useAuth['"]/);
    expect(code).not.toMatch(/from\s+['"]\.\/hooks\/useTheme['"]/);
    expect(code).not.toMatch(/<AuthProvider/);
    expect(code).not.toMatch(/<ThemeProvider/);
  });

  it('App.tsx code (excluding comments) no longer imports the legacy api/client surface', () => {
    const code = stripComments(fs.readFileSync(path.resolve(__dirname, 'App.tsx'), 'utf-8'));
    expect(code).not.toMatch(/from\s+['"]\.\/api\/client['"]/);
    expect(code).not.toMatch(/fetchLogs|clearLogs|fetchLocalVersion/);
  });
});
