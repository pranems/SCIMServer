/**
 * route-suspense.test.ts - Phase K1 source-pattern contract for the
 * root route's Suspense boundary.
 *
 * Asserts that [web/src/routes/__root.tsx](./__root.tsx) wraps the
 * `<Outlet />` in a `<React.Suspense fallback={...} />` boundary so
 * the route-level lazy loads (Phase K1) have a single shared loading
 * surface.
 *
 * The pre-existing Suspense around the dev-only TanStack Router
 * Devtools is unrelated and must remain - this test asserts there is
 * a SECOND Suspense wrapping the production `<Outlet />` with a
 * non-null fallback. Without this boundary, lazy route loads would
 * bubble up to the nearest ancestor and most likely render nothing
 * for the brief network-bound flash, with Fluent UI's FluentProvider
 * tearing on color-scheme switch.
 *
 * @see docs/PHASE_K1_ROUTE_CODE_SPLITTING.md
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT_FILE = path.resolve(__dirname, '__root.tsx');

function readRoot(): string {
  return fs.readFileSync(ROOT_FILE, 'utf-8');
}

function strippedSource(): string {
  return readRoot()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('Phase K1 - root route Suspense boundary', () => {
  it('__root.tsx exists', () => {
    expect(fs.existsSync(ROOT_FILE)).toBe(true);
  });

  it('wraps <Outlet /> in a <React.Suspense ... fallback={...}>', () => {
    const src = strippedSource();
    // Find a Suspense whose body contains an Outlet. Be generous about
    // attributes/whitespace; we only assert the structural wrapping.
    const pattern = /<React\.Suspense[\s\S]*?fallback=\{[\s\S]*?\}[\s\S]*?>[\s\S]*?<Outlet\s*\/>[\s\S]*?<\/React\.Suspense>/;
    expect(
      pattern.test(src),
      '__root.tsx: expected <React.Suspense fallback={...}><Outlet /></React.Suspense> wrapping the route Outlet',
    ).toBe(true);
  });

  it('imports a route-loading fallback component (LoadingSkeleton or named RouteLoadingFallback)', () => {
    const src = strippedSource();
    const importsLoadingSkeleton = /from\s+['\"]\.\.\/components\/primitives['\"]/.test(src) &&
      /\bLoadingSkeleton\b/.test(src);
    const definesNamedFallback = /RouteLoadingFallback/.test(src);
    expect(
      importsLoadingSkeleton || definesNamedFallback,
      '__root.tsx: expected to import LoadingSkeleton from ../components/primitives or define a RouteLoadingFallback',
    ).toBe(true);
  });
});
