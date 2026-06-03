import '@testing-library/jest-dom/vitest';

// Phase H1 - opt-in MSW server lifecycle.
//
// MSW (Node) lifecycle is opted into per test file via:
//   import { server } from '@/test/msw/server';
//   beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
//   afterEach(() => server.resetHandlers());
//   afterAll(() => server.close());
//
// History: in Phase H1 we evaluated globally enabling MSW here, but
// MSW v2 in Node intercepts BELOW `globalThis.fetch` and broke 24
// legacy `vi.stubGlobal('fetch')` tests in the pre-redesign legacy
// component tree. Phase I2 deleted that tree; the global default
// could now be enabled here without breaking anything, but the
// per-file pattern is still preferred because it makes the network-
// mock dependency explicit at the spec level (no hidden global
// behavior). See `web/src/test/msw.integration.test.tsx` for the
// canonical pattern.

// Minimal localStorage mock (jsdom provides one but ensure it's clean between tests)
beforeEach(() => {
  localStorage.clear();
});

// ─── Browser API shims jsdom is missing ──────────────────────────────
//
// jsdom does NOT implement ResizeObserver. Several Fluent UI components
// (Drawer focus management) and recharts' ResponsiveContainer rely on
// it. Tests that render those components in isolation crash with
// "ResizeObserver is not defined" or render at 0x0 unless we install
// a stub. Doing it once here keeps every test file from re-installing
// the shim ad-hoc (Phase C cleanup F-15).
if (typeof globalThis.ResizeObserver === 'undefined') {
  class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver = StubResizeObserver;
}

// jsdom does NOT implement matchMedia. Fluent UI's theme detection /
// reduced-motion media queries hit it during render. Provide an
// always-no-match stub so components render in the deterministic
// "default" branch.
if (typeof window !== 'undefined' && typeof window.matchMedia === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// jsdom does NOT implement Element.scrollIntoView. cmdk (Phase F1
// command palette) calls it on each highlighted item to keep it in
// view; tests crash with "scrollIntoView is not a function" without
// this stub.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}
