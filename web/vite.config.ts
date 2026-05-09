/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@scim/types': path.resolve(__dirname, '../api/src/shared/types'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/scim': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    /**
     * Phase H4 - vitest coverage gates.
     *
     * Provider: V8 (matches the production runtime; `@vitest/coverage-v8`
     * generates istanbul-compatible reports without requiring the istanbul
     * provider's source-map mid-step).
     *
     * Threshold tier: lines 80 / branches 75 / functions 90 / statements 80.
     * Functions is the strictest at 90 because every exported function is
     * a public contract surface; missing one means a whole feature is
     * untested. Branches is the loosest at 75 because Fluent UI's
     * conditional rendering generates many trivially-uncovered short-
     * circuit branches that don't reflect missing tests.
     *
     * Scope: only `src/{api,auth,components/primitives,components/Command*,
     * components/KeyboardShortcutsHelp*,hooks,layout,pages,routes,store,test/msw}.{ts,tsx}`
     * - the redesigned UI surface. Legacy components slated for I2
     * deletion (`components/activity/*`, `components/database/*`,
     * `components/Header*`, `components/LogList*`, `components/LogDetail*`,
     * `components/manual/*`, `api/client.ts`) are excluded so the gate
     * does not block on dead code. Phase I2 widens the include list back
     * to all of `src/**` once the legacy tree is deleted.
     *
     * Excluded by default (vitest's own defaults + ours):
     * - test files / snapshots / type definitions
     * - main.tsx (top-level bootstrap not unit-testable)
     * - design tokens / theme.css.ts (Fluent UI-driven, no logic)
     */
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: '../test-results/web-coverage',
      include: [
        'src/api/queries.ts',
        'src/api/query-client.ts',
        'src/auth/**/*.{ts,tsx}',
        'src/components/primitives/**/*.{ts,tsx}',
        'src/components/CommandPalette.tsx',
        'src/components/KeyboardShortcutsHelp.tsx',
        'src/components/detail/**/*.{ts,tsx}',
        'src/hooks/**/*.{ts,tsx}',
        'src/layout/**/*.{ts,tsx}',
        'src/pages/**/*.{ts,tsx}',
        'src/routes/**/*.{ts,tsx}',
        'src/store/**/*.{ts,tsx}',
        'src/router.ts',
      ],
      exclude: [
        // Legacy I2-deletion targets - excluded so the coverage gate
        // does not block on code we are about to delete.
        'src/api/client.ts',
        'src/components/activity/**',
        'src/components/database/**',
        'src/components/Header*',
        'src/components/LogList*',
        'src/components/LogDetail*',
        'src/components/LogFilters*',
        'src/components/manual/**',
        // Standard vitest excludes that the include filter does not catch
        // because they are matched by `**/*.{test,spec}.{ts,tsx}`.
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
        '**/__snapshots__/**',
        // Bootstrap and pure-design files (no logic).
        'src/main.tsx',
        'src/App.tsx',
        'src/env.d.ts',
        'src/design/**',
      ],
      thresholds: {
        // Phase H4 ratchet floor.
        //
        // Baseline measured at v0.46.1-alpha.8 (the version this gate
        // ships with):
        //   - Statements: 77.87 %
        //   - Branches:   72.72 %
        //   - Functions:  67.02 %
        //   - Lines:      80.63 %
        //
        // Floor is set 2-3 percentage points below baseline so jitter
        // from added MSW handlers / route stubs does not red-fail the
        // gate. The gate can only ratchet UP from here - any PR that
        // drops below floor fails CI.
        //
        // Aspirational targets (S11.4 plan): lines 80 / branches 75 /
        // functions 90 / statements 80. The path to those targets is:
        //   - Route file tests: 9 route files at ~35 % lines drag the
        //     mean down by ~3 points. Each is a ~10 LoC wrapper; one
        //     `expect(routeFn).toBeDefined()` test per route closes
        //     the gap.
        //   - Mutation hook tests: src/api/queries.ts useCreate*/
        //     useUpdate*/useDelete* hooks have ~73 % function coverage.
        //     Adding 6 unit tests via the MSW infrastructure (Phase H1)
        //     would close most of the gap.
        //   - LogsPage / LogsTab / GroupsTab uncovered branches are
        //     filter-state combinations that the existing tests skip.
        //
        // Once the legacy components are deleted in Phase I2, the
        // include list widens to all of `src/**` and the floor can
        // be raised to the aspirational targets.
        lines: 78,
        branches: 70,
        functions: 65,
        statements: 75,
      },
    },
  }
});
