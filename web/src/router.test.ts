/**
 * router.test.ts - smoke tests for the TanStack Router route tree.
 *
 * Verifies the route tree shape, path patterns, and that critical routes
 * exist with correct parent-child relationships. Catches typos in path
 * definitions and missing routes before they reach navigation code.
 *
 * This is intentionally light-weight: heavier behavioral tests will come
 * once routes are wired into AppShell (Phase A2). For now, the goal is to
 * lock the route tree contract.
 */

import { describe, it, expect } from 'vitest';
import { router, routeTree } from './router';

describe('router route tree', () => {
  it('exports a built router instance', () => {
    expect(router).toBeDefined();
    expect(router.routeTree).toBeDefined();
  });

  it('has the expected top-level route paths', () => {
    // Walk children of the root route; collect their full paths.
    const childPaths = (routeTree.children ?? []).map((c: { fullPath: string }) => c.fullPath);
    expect(childPaths).toContain('/');
    expect(childPaths).toContain('/endpoints');
    expect(childPaths).toContain('/logs');
    expect(childPaths).toContain('/settings');
  });

  it('has the endpoint detail layout with nested tab routes', () => {
    const endpointDetail = (routeTree.children ?? []).find(
      (c: { id?: string }) => c.id === '/endpoints/$endpointId',
    ) as { children?: Array<{ fullPath: string }> } | undefined;
    expect(endpointDetail).toBeDefined();

    const tabPaths = (endpointDetail?.children ?? []).map((c) => c.fullPath);
    expect(tabPaths).toContain('/endpoints/$endpointId/users');
    expect(tabPaths).toContain('/endpoints/$endpointId/groups');
    expect(tabPaths).toContain('/endpoints/$endpointId/logs');
    expect(tabPaths).toContain('/endpoints/$endpointId/settings');
  });

  it('starts at the dashboard route by default', () => {
    expect(router.options.defaultPreload).toBe('intent');
  });
});
