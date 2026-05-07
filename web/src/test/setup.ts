import '@testing-library/jest-dom/vitest';

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
