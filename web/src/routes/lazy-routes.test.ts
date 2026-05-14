/**
 * lazy-routes.test.ts - Phase K1 source-pattern contract.
 *
 * Asserts that every TanStack Router route file under
 * [web/src/routes/](.) imports its page component via
 * `React.lazy(() => import('../pages/X').then(...))` rather than a
 * static `import { X } from '../pages/X'`.
 *
 * Phase K1 (post-Phase-I) introduces route-level code splitting so
 * the initial JS payload only loads the chrome + the matched route's
 * chunk. Without a regression-locking source pattern test, a future
 * PR can silently re-introduce a static import (because the lazy
 * helper is verbose) and the bundle re-collapses into a single
 * chunk - which `npm run size` would only catch on the *next* PR
 * after the regression.
 *
 * The pattern is regex-based and additive: it asserts each route
 * file contains a `React.lazy(()` call AND does NOT contain a
 * top-level static `import { <PageComponent> } from '../pages/`. New
 * routes must be added to the `ROUTE_FILES` table below; tests fail
 * with a clear message if a route file is missing or its page
 * component name cannot be inferred.
 *
 * @see docs/UI_NEXT_GAPS_LATERAL_ANALYSIS_2026.md §5.1
 * @see docs/PHASE_K1_ROUTE_CODE_SPLITTING.md
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROUTES_DIR = path.resolve(__dirname);

interface RouteFile {
  /** File name under web/src/routes/ */
  file: string;
  /** Page component(s) the route file should lazy-import */
  pageComponents: string[];
}

/**
 * Every production route file plus the page component(s) it should
 * lazy-load. Layout-only route files (no page component, only
 * <Outlet />) are excluded - currently none.
 */
const ROUTE_FILES: ReadonlyArray<RouteFile> = [
  { file: 'index.tsx', pageComponents: ['DashboardPage'] },
  { file: 'endpoints.tsx', pageComponents: ['EndpointsPage'] },
  { file: 'endpoints.$endpointId.tsx', pageComponents: ['EndpointDetailPage'] },
  { file: 'endpoints.$endpointId.index.tsx', pageComponents: ['OverviewTab'] },
  { file: 'endpoints.$endpointId.users.tsx', pageComponents: ['UsersTab'] },
  { file: 'endpoints.$endpointId.groups.tsx', pageComponents: ['GroupsTab'] },
  { file: 'endpoints.$endpointId.activity.tsx', pageComponents: ['ActivityTab'] },
  { file: 'endpoints.$endpointId.schemas.tsx', pageComponents: ['SchemasTab'] },
  { file: 'endpoints.$endpointId.credentials.tsx', pageComponents: ['CredentialsTab'] },
  { file: 'endpoints.$endpointId.logs.tsx', pageComponents: ['LogsTab'] },
  { file: 'endpoints.$endpointId.settings.tsx', pageComponents: ['SettingsTab'] },
  { file: 'logs.tsx', pageComponents: ['LogsPage'] },
  { file: 'manual-provision.tsx', pageComponents: ['ManualProvisionPage'] },
  { file: 'settings.tsx', pageComponents: ['SettingsPage'] },
  // Phase L1
  { file: 'endpoints.new.tsx', pageComponents: ['CreateEndpointWizard'] },
  { file: 'endpoints.$endpointId.edit.tsx', pageComponents: ['EditEndpointPage'] },
  // Phase L2
  { file: 'me.tsx', pageComponents: ['MeProfilePage'] },
  // Phase L5
  { file: 'discovery.tsx', pageComponents: ['DiscoveryExplorerPage'] },
  // Phase L6
  { file: 'operations.tsx', pageComponents: ['OperationsPage'] },
];

function readRoute(file: string): string {
  const fullPath = path.join(ROUTES_DIR, file);
  return fs.readFileSync(fullPath, 'utf-8');
}

describe('Phase K1 - route files lazy-load their page components', () => {
  it('all expected route files exist on disk', () => {
    for (const { file } of ROUTE_FILES) {
      const fullPath = path.join(ROUTES_DIR, file);
      expect(fs.existsSync(fullPath), `route file missing: ${file}`).toBe(true);
    }
  });

  it.each(ROUTE_FILES)(
    '$file uses React.lazy + dynamic import for its page component(s)',
    ({ file, pageComponents }) => {
      const source = readRoute(file);
      // Must call React.lazy at module scope.
      expect(
        /React\.lazy\s*\(/.test(source),
        `${file}: expected a React.lazy(() => ...) call, found none`,
      ).toBe(true);
      // Must call dynamic import for each page component.
      for (const comp of pageComponents) {
        const dynamicImportPattern = new RegExp(
          `import\\(\\s*['\"]\\.\\./pages/${comp}['\"]\\s*\\)`,
        );
        expect(
          dynamicImportPattern.test(source),
          `${file}: expected dynamic import('../pages/${comp}'), found none`,
        ).toBe(true);
      }
    },
  );

  it.each(ROUTE_FILES)(
    '$file does NOT use a static `import { <Page> } from "../pages/..."`',
    ({ file, pageComponents }) => {
      const source = readRoute(file);
      // Strip block + line comments so docstring references don't false-positive.
      const stripped = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const comp of pageComponents) {
        const staticImportPattern = new RegExp(
          `import\\s*\\{[^}]*\\b${comp}\\b[^}]*\\}\\s*from\\s*['\"]\\.\\./pages/${comp}['\"]`,
        );
        expect(
          staticImportPattern.test(stripped),
          `${file}: contains a static \`import { ${comp} } from '../pages/${comp}'\` - replace with React.lazy + dynamic import to enable per-route code splitting`,
        ).toBe(false);
      }
    },
  );
});
