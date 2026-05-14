/**
 * Phase H6 - size-limit budget contract test.
 *
 * Asserts that the `size-limit` block in [web/package.json](../../package.json)
 * declares the documented budgets and the documented `path` /
 * `gzip` fields so a future PR cannot accidentally weaken the gate
 * (silently raising the budget, removing a budget, switching from
 * gzip to raw byte count, etc.).
 *
 * This is a config-contract test, NOT a functional measurement: the
 * actual size measurement runs in CI via `npm run size`. This test
 * just locks the configuration shape.
 *
 * @see docs/PHASE_H6_SIZE_LIMIT_BUDGETS.md
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PACKAGE_JSON_PATH = path.resolve(__dirname, '..', '..', 'package.json');
const PACKAGE_JSON = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf-8'));

interface SizeLimitEntry {
  name: string;
  path: string;
  limit: string;
  gzip?: boolean;
}

describe('Phase H6 - size-limit budget contract', () => {
  const entries: SizeLimitEntry[] = PACKAGE_JSON['size-limit'];

  it('package.json declares a size-limit block', () => {
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThanOrEqual(1);
  });

  it('declares the JS bundle budget (Phase I2 dropped the separate CSS bundle - Fluent UI uses CSS-in-JS)', () => {
    // Phase K1 - the main entry chunk is now `index-*.js` (the rest are
    // per-route lazy chunks). Match by name to avoid false-matching a
    // per-route entry as the main bundle.
    const jsEntry = entries.find((e) => e.path === 'dist/assets/index-*.js');
    expect(jsEntry, 'missing main entry bundle budget (path dist/assets/index-*.js)').toBeDefined();
  });

  it('JS budget is enforced gzipped (raw-byte budgets are misleading - users download gzip)', () => {
    const jsEntry = entries.find((e) => e.path === 'dist/assets/index-*.js')!;
    expect(jsEntry.gzip).toBe(true);
  });

  it('Main entry budget is at the post-K1 ratchet floor (<= 200 KB) and not silently raised', () => {
    // Phase K1 baseline: 146.49 KB gzipped (post route code-splitting,
    // down from 381.49 KB pre-K1, a 62% reduction).
    // Floor 200 KB gives ~37% headroom over the K1 baseline so adding a
    // small dep does not red-fail CI but a regression on the order of
    // a heavy dep landing in the entry chunk does. Lowering this is
    // fine; raising requires updating this test (deliberate decision).
    const jsEntry = entries.find((e) => e.path === 'dist/assets/index-*.js')!;
    const matched = jsEntry.limit.match(/^(\d+(?:\.\d+)?)\s*KB$/);
    expect(matched, `expected limit to be in 'NNN KB' format, got '${jsEntry.limit}'`).not.toBeNull();
    const limitKb = Number(matched![1]);
    expect(limitKb).toBeLessThanOrEqual(200);
  });

  it('Phase K1 declares a shared primitives chunk budget (<= 220 KB gzipped)', () => {
    // The primitives barrel (DetailDrawer + EmptyState + KpiChart +
    // LoadingSkeleton + ErrorBoundary + FormDialog + Switch surfaces)
    // is shared across multiple lazy routes so vite emits it as its
    // own chunk. K1 baseline: 174.57 KB gzipped.
    const primEntry = entries.find((e) => e.path === 'dist/assets/primitives-*.js');
    expect(primEntry, 'missing primitives chunk budget (path dist/assets/primitives-*.js)').toBeDefined();
    expect(primEntry?.gzip).toBe(true);
    const matched = primEntry!.limit.match(/^(\d+(?:\.\d+)?)\s*KB$/);
    expect(matched, `expected '<NNN> KB' for primitives, got '${primEntry!.limit}'`).not.toBeNull();
    const limitKb = Number(matched![1]);
    expect(limitKb).toBeLessThanOrEqual(220);
  });

  it('paths target the built dist/assets/* output (not src)', () => {
    for (const entry of entries) {
      expect(
        entry.path,
        `expected size-limit entry path to start with 'dist/' (got '${entry.path}')`,
      ).toMatch(/^dist\//);
    }
  });

  it('exposes "size" and "size:why" npm scripts', () => {
    expect(PACKAGE_JSON.scripts.size).toBe('size-limit');
    expect(PACKAGE_JSON.scripts['size:why']).toBe('size-limit --why');
  });

  // ─── Phase K1 - per-route chunk budgets ──────────────────────────
  //
  // After Phase K1 each top-level route is `React.lazy(() => import(...))`
  // so vite emits one chunk per route page. The main bundle drops
  // significantly (target: ~200 KB gzipped post-K1, down from
  // 381 KB pre-K1). Adding per-route entries keeps each route page
  // under a per-page budget so a future PR cannot silently bloat one
  // route by importing a heavy dep into it (e.g. a chart library).
  //
  // The plan §12 budgets are: dashboard 90 KB, endpoint detail
  // 110 KB. K1 adopts a uniform 110 KB cap across all routes for
  // simplicity; a future tightening pass can split per-route once
  // baselines stabilize.

  describe('Phase K1 - per-route chunk budgets', () => {
    const ROUTE_CHUNK_NAMES = [
      'DashboardPage',
      'EndpointsPage',
      'EndpointDetailPage',
      'OverviewTab',
      'UsersTab',
      'GroupsTab',
      'ActivityTab',
      'SchemasTab',
      'CredentialsTab',
      'LogsTab',
      'SettingsTab',
      'LogsPage',
      'ManualProvisionPage',
      'SettingsPage',
      // Phase L1
      'CreateEndpointWizard',
      'EditEndpointPage',
      // Phase L2
      'MeProfilePage',
      // Phase L5
      'DiscoveryExplorerPage',
      // Phase L6
      'OperationsPage',
    ] as const;

    it.each(ROUTE_CHUNK_NAMES)(
      'declares a per-route chunk budget for %s',
      (chunkName) => {
        const entry = entries.find(
          (e) => e.path.includes(`${chunkName}-`) || e.name === chunkName,
        );
        expect(
          entry,
          `expected size-limit entry for route chunk '${chunkName}' (path glob 'dist/assets/${chunkName}-*.js')`,
        ).toBeDefined();
        // Per-route chunks must be gzipped budgets too.
        expect(entry?.gzip).toBe(true);
      },
    );

    it('every per-route entry path globs the dist/assets/<Name>-*.js convention', () => {
      const routeEntries = entries.filter((e) =>
        ROUTE_CHUNK_NAMES.some((name) => e.path.includes(`${name}-`)),
      );
      for (const entry of routeEntries) {
        expect(
          /^dist\/assets\/[A-Z][A-Za-z]+-\*\.js$/.test(entry.path),
          `expected path 'dist/assets/<Name>-*.js' (got '${entry.path}')`,
        ).toBe(true);
      }
    });

    it('every per-route entry budget is <= 110 KB (plan section 12 ceiling)', () => {
      const routeEntries = entries.filter((e) =>
        ROUTE_CHUNK_NAMES.some((name) => e.path.includes(`${name}-`)),
      );
      for (const entry of routeEntries) {
        const matched = entry.limit.match(/^(\d+(?:\.\d+)?)\s*KB$/);
        expect(matched, `expected '<NNN> KB' for ${entry.name}, got '${entry.limit}'`).not.toBeNull();
        const limitKb = Number(matched![1]);
        expect(
          limitKb,
          `${entry.name} limit ${limitKb} KB exceeds plan section 12 ceiling of 110 KB`,
        ).toBeLessThanOrEqual(110);
      }
    });
  });
});
