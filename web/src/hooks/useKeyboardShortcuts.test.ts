/**
 * useKeyboardShortcuts tests (Phase F2).
 *
 * Validates the global keyboard shortcut hook:
 *   - Sequence shortcuts: g d / g e / g l / g s / g m / g p (200ms reset window)
 *   - Single-key: / (focus global search), ? (open help)
 *   - Suppressed when target is an editable field (input, textarea, contenteditable)
 *   - Suppressed when a modifier key is held (Cmd / Ctrl / Alt / Meta)
 *
 * The hook is a thin imperative layer over `document.addEventListener('keydown')`.
 * Tests dispatch synthetic KeyboardEvents to assert the handlers fire / don't fire.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

function dispatch(key: string, opts: KeyboardEventInit = {}, target?: EventTarget): void {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts });
  if (target) {
    target.dispatchEvent(event);
  } else {
    document.dispatchEvent(event);
  }
}

describe('useKeyboardShortcuts', () => {
  let onNavigate: ReturnType<typeof vi.fn>;
  let onFocusSearch: ReturnType<typeof vi.fn>;
  let onShowHelp: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onNavigate = vi.fn();
    onFocusSearch = vi.fn();
    onShowHelp = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── g <x> sequence shortcuts ─────────────────────────────────────

  it('g d navigates to dashboard /', () => {
    renderHook(() => useKeyboardShortcuts({ onNavigate, onFocusSearch, onShowHelp }));
    dispatch('g');
    dispatch('d');
    expect(onNavigate).toHaveBeenCalledWith('/');
  });

  it('g e navigates to /endpoints', () => {
    renderHook(() => useKeyboardShortcuts({ onNavigate, onFocusSearch, onShowHelp }));
    dispatch('g');
    dispatch('e');
    expect(onNavigate).toHaveBeenCalledWith('/endpoints');
  });

  it('g l navigates to /logs', () => {
    renderHook(() => useKeyboardShortcuts({ onNavigate, onFocusSearch, onShowHelp }));
    dispatch('g');
    dispatch('l');
    expect(onNavigate).toHaveBeenCalledWith('/logs');
  });

  it('g s navigates to /settings', () => {
    renderHook(() => useKeyboardShortcuts({ onNavigate, onFocusSearch, onShowHelp }));
    dispatch('g');
    dispatch('s');
    expect(onNavigate).toHaveBeenCalledWith('/settings');
  });

  it('g m navigates to /manual-provision', () => {
    renderHook(() => useKeyboardShortcuts({ onNavigate, onFocusSearch, onShowHelp }));
    dispatch('g');
    dispatch('m');
    expect(onNavigate).toHaveBeenCalledWith('/manual-provision');
  });

  // ─── Sequence reset window ───────────────────────────────────────

  it('g times out after the reset window so the second key is ignored', () => {
    renderHook(() => useKeyboardShortcuts({ onNavigate, onFocusSearch, onShowHelp }));
    dispatch('g');
    act(() => {
      vi.advanceTimersByTime(2000); // > 1000ms reset window
    });
    dispatch('d');
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('an unrelated key in the middle of g <x> resets the sequence', () => {
    renderHook(() => useKeyboardShortcuts({ onNavigate, onFocusSearch, onShowHelp }));
    dispatch('g');
    dispatch('x'); // not a recognised second key
    dispatch('d'); // should not fire because sequence was reset
    expect(onNavigate).not.toHaveBeenCalled();
  });

  // ─── Single-key shortcuts ────────────────────────────────────────

  it('/ fires onFocusSearch', () => {
    renderHook(() => useKeyboardShortcuts({ onNavigate, onFocusSearch, onShowHelp }));
    dispatch('/');
    expect(onFocusSearch).toHaveBeenCalled();
  });

  it('? fires onShowHelp', () => {
    renderHook(() => useKeyboardShortcuts({ onNavigate, onFocusSearch, onShowHelp }));
    dispatch('?');
    expect(onShowHelp).toHaveBeenCalled();
  });

  // ─── Suppression: typing in inputs ───────────────────────────────

  it('does NOT fire shortcuts when typing in an <input>', () => {
    renderHook(() => useKeyboardShortcuts({ onNavigate, onFocusSearch, onShowHelp }));
    const input = document.createElement('input');
    document.body.appendChild(input);
    dispatch('g', {}, input);
    dispatch('d', {}, input);
    expect(onNavigate).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('does NOT fire / when typing in a <textarea>', () => {
    renderHook(() => useKeyboardShortcuts({ onNavigate, onFocusSearch, onShowHelp }));
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    dispatch('/', {}, ta);
    expect(onFocusSearch).not.toHaveBeenCalled();
    document.body.removeChild(ta);
  });

  it('does NOT fire ? when typing in a contenteditable element', () => {
    renderHook(() => useKeyboardShortcuts({ onNavigate, onFocusSearch, onShowHelp }));
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    document.body.appendChild(div);
    dispatch('?', {}, div);
    expect(onShowHelp).not.toHaveBeenCalled();
    document.body.removeChild(div);
  });

  // ─── Suppression: modifier keys ──────────────────────────────────

  it('does NOT fire g d when Ctrl is held (avoids browser shortcut clash)', () => {
    renderHook(() => useKeyboardShortcuts({ onNavigate, onFocusSearch, onShowHelp }));
    dispatch('g', { ctrlKey: true });
    dispatch('d', { ctrlKey: true });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('does NOT fire / when Cmd is held', () => {
    renderHook(() => useKeyboardShortcuts({ onNavigate, onFocusSearch, onShowHelp }));
    dispatch('/', { metaKey: true });
    expect(onFocusSearch).not.toHaveBeenCalled();
  });

  // ─── Cleanup ─────────────────────────────────────────────────────

  it('removes the listener on unmount', () => {
    const { unmount } = renderHook(() =>
      useKeyboardShortcuts({ onNavigate, onFocusSearch, onShowHelp }),
    );
    unmount();
    dispatch('g');
    dispatch('d');
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
