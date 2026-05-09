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
    const jsEntry = entries.find((e) => e.path.endsWith('.js'));
    expect(jsEntry, 'missing JS bundle budget entry').toBeDefined();
  });

  it('JS budget is enforced gzipped (raw-byte budgets are misleading - users download gzip)', () => {
    const jsEntry = entries.find((e) => e.path.endsWith('.js'))!;
    expect(jsEntry.gzip).toBe(true);
  });

  it('JS budget is at the post-I2 ratchet floor (<= 400 KB) and not silently raised', () => {
    // Floor measured at v0.48.0 (post legacy-cleanup): 377.33 KB gzipped.
    // Floor 400 KB gives ~6 % headroom for jitter from added Fluent UI
    // components / route additions. Lowering this value is fine; raising
    // it requires updating this test (a deliberate decision).
    const jsEntry = entries.find((e) => e.path.endsWith('.js'))!;
    const matched = jsEntry.limit.match(/^(\d+(?:\.\d+)?)\s*KB$/);
    expect(matched, `expected limit to be in 'NNN KB' format, got '${jsEntry.limit}'`).not.toBeNull();
    const limitKb = Number(matched![1]);
    expect(limitKb).toBeLessThanOrEqual(400);
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
});
