/**
 * Phase B.3 (v0.48.1) - main.tsx MSW worker mount contract test.
 *
 * Asserts that [web/src/main.tsx](../main.tsx) wires the MSW browser
 * worker behind the documented `VITE_USE_MSW === 'true'` opt-in so the
 * Phase H3 cross-tab SSE Playwright spec
 * (`web/e2e/sse-cross-tab.spec.ts`) can actually run with deterministic
 * mocked SCIM mutations driving the SSE stream.
 *
 * Why a source-pattern test instead of an integration test:
 *   - main.tsx executes at module load (top-level `createRoot`) and
 *     mounts a real React tree, which makes vitest setup awkward.
 *   - The contract we need to lock is the SHAPE of the wiring (env
 *     guard + dynamic import + worker.start), not the runtime effect.
 *   - Identical to the codebase pattern used by
 *     [web/src/test/size-limit-config.test.ts](./size-limit-config.test.ts)
 *     and api-side `forbidden-source-patterns.spec.ts`: source-scan
 *     regression guard so a future refactor cannot silently delete the
 *     opt-in.
 *
 * @see docs/PHASE_J_SSE_EVENT_BRIDGE.md
 * @see web/src/test/msw/browser.ts (the worker exported here)
 * @see web/e2e/sse-cross-tab.spec.ts (consumer that depends on this mount)
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const MAIN_TSX_PATH = path.resolve(__dirname, '..', 'main.tsx');
const MAIN_TSX = fs.readFileSync(MAIN_TSX_PATH, 'utf-8');

describe('Phase B.3 (v0.48.1) - main.tsx MSW worker mount', () => {
  it('main.tsx exists at the expected path', () => {
    expect(fs.existsSync(MAIN_TSX_PATH)).toBe(true);
  });

  it('guards the MSW mount on import.meta.env.VITE_USE_MSW (production builds tree-shake)', () => {
    // The exact env-var name is documented in web/src/test/msw/browser.ts;
    // changing it would silently break the Playwright cross-tab spec, so
    // we lock it here.
    expect(MAIN_TSX).toMatch(/import\.meta\.env\.VITE_USE_MSW/);
  });

  it('compares VITE_USE_MSW against the literal string \'true\' (Vite env vars are always strings)', () => {
    // Reject `if (import.meta.env.VITE_USE_MSW)` (truthy-on-any-string)
    // and `=== true` (would never match because Vite stringifies env).
    expect(MAIN_TSX).toMatch(/VITE_USE_MSW\s*===\s*['"]true['"]/);
  });

  it('dynamically imports the MSW browser worker (keeps it out of the prod chunk)', () => {
    // Static `import { worker } from './test/msw/browser'` would defeat
    // tree-shaking; only a dynamic `await import(...)` inside the
    // env-guarded branch is acceptable.
    expect(MAIN_TSX).toMatch(/await\s+import\(['"][^'"]*test\/msw\/browser['"]\)/);
  });

  it('calls worker.start with onUnhandledRequest: \'bypass\' (do not block /scim/* requests)', () => {
    // The default `onUnhandledRequest: 'warn'` floods the Playwright
    // console; bypass keeps unmocked requests flowing to the real API.
    expect(MAIN_TSX).toMatch(/worker\.start\s*\(\s*\{[^}]*onUnhandledRequest\s*:\s*['"]bypass['"]/);
  });

  it('awaits the worker.start before createRoot to avoid the first-paint race', () => {
    // If createRoot runs before the worker is ready, the initial set of
    // queries fires against the real API and the cross-tab spec sees a
    // mix of real + mocked responses. Locking the order here.
    //
    // Match against the ACTUAL call sites (with their argument-list
    // opening tokens) so a JSDoc comment that narratively references
    // either symbol earlier in the file does not throw the ordering
    // off.
    const startIdx = MAIN_TSX.indexOf('worker.start({');
    const rootIdx = MAIN_TSX.indexOf('createRoot(document');
    expect(startIdx).toBeGreaterThan(-1);
    expect(rootIdx).toBeGreaterThan(-1);
    expect(startIdx).toBeLessThan(rootIdx);
  });
});
