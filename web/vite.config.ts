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
     * Phase H4 + I2 - vitest coverage gates (post legacy-cleanup).
     *
     * Provider: V8 (matches the production runtime; `@vitest/coverage-v8`
     * generates istanbul-compatible reports without requiring the istanbul
     * provider's source-map mid-step).
     *
     * Phase I2 deleted the legacy `api/client.ts`,
     * `components/{activity,database,manual}/`, and
     * `components/{Header,LogList,LogDetail,LogFilters}*` files. The
     * coverage gate's `include` is now widened to ALL of the redesigned
     * UI surface (no per-folder allowlist needed) and the I2-specific
     * `exclude` patterns have been removed. Thresholds are unchanged
     * from H4 baseline.
     */
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: '../test-results/web-coverage',
      include: [
        // Whole src/ tree minus the well-known no-logic / pre-bundle
        // folders below. After Phase I2 there is no legacy code to
        // exclude.
        'src/**/*.{ts,tsx}',
      ],
      exclude: [
        // Standard vitest excludes that the include filter does not catch
        // because they are matched by `**/*.{test,spec}.{ts,tsx}`.
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
        '**/__snapshots__/**',
        // Bootstrap / pure-design / type-only files (no logic).
        'src/main.tsx',
        'src/App.tsx',
        'src/env.d.ts',
        'src/design/**',
        // Test infrastructure - no logic to gate.
        'src/test/**',
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
