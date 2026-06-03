/**
 * useKeyboardShortcuts - global keyboard shortcut hook (Phase F2).
 *
 * Implements the GitHub / Linear-style keyboard navigation pattern:
 *   - `g d` -> Dashboard (/)
 *   - `g e` -> Endpoints (/endpoints)
 *   - `g m` -> Manual Provision (/manual-provision)
 *   - `g l` -> Logs (/logs)
 *   - `g s` -> Settings (/settings)
 *   - `/`   -> focus the global search (palette open)
 *   - `?`   -> open the shortcuts help modal
 *
 * Sequence handling:
 *   - When `g` is pressed, a 1000ms window opens during which the next key
 *     is treated as the second character of the sequence. After the window
 *     elapses, the buffer is cleared.
 *   - An unrecognised second key resets the buffer (so `g x` does NOT fire
 *     anything; pressing `d` afterwards does nothing either).
 *
 * Suppression rules:
 *   - When the keydown target is a writable input (`<input>`, `<textarea>`,
 *     contenteditable), shortcuts are skipped so the user can type into
 *     forms / SCIM filters / the command palette.
 *   - When any modifier key is held (Cmd/Ctrl/Alt/Meta), shortcuts are
 *     skipped so we never fight the browser's own bindings (Cmd+K is
 *     handled separately by the command palette via `useCommandPaletteShortcut`).
 */
import { useEffect, useRef } from 'react';

const SEQUENCE_RESET_MS = 1000;

const SEQUENCE_MAP: Readonly<Record<string, string>> = {
  d: '/',
  e: '/endpoints',
  m: '/manual-provision',
  l: '/logs',
  s: '/settings',
};

export interface KeyboardShortcutHandlers {
  /** Navigate to the supplied pathname. */
  onNavigate: (to: string) => void;
  /** Focus the global search affordance (currently the command palette). */
  onFocusSearch: () => void;
  /** Open the shortcuts help modal. */
  onShowHelp: () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  // Check both the boolean property and the attribute string - jsdom
  // doesn't always populate `isContentEditable` even when the
  // contenteditable attribute is set.
  if (target.isContentEditable) return true;
  const ce = target.getAttribute('contenteditable');
  if (ce !== null && ce !== 'false') return true;
  return false;
}

function hasModifier(e: KeyboardEvent): boolean {
  return e.ctrlKey || e.metaKey || e.altKey;
}

export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers): void {
  // Mutable refs avoid re-binding the listener on every handler reference change.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  // Sequence buffer: tracks whether the last key was `g` and when it expires.
  const sequenceRef = useRef<{ key: string; expiresAt: number } | null>(null);

  useEffect(() => {
    function handler(e: KeyboardEvent): void {
      if (isEditableTarget(e.target)) return;
      if (hasModifier(e)) return;

      const now = Date.now();
      const seq = sequenceRef.current;

      // ─── Second key of g <x> sequence ─────────────────────────
      if (seq && seq.key === 'g' && now <= seq.expiresAt) {
        sequenceRef.current = null;
        const target = SEQUENCE_MAP[e.key.toLowerCase()];
        if (target) {
          e.preventDefault();
          handlersRef.current.onNavigate(target);
        }
        // Unrecognised second key: buffer cleared, nothing fired.
        return;
      }

      // ─── First key of a sequence ─────────────────────────────
      if (e.key === 'g') {
        sequenceRef.current = { key: 'g', expiresAt: now + SEQUENCE_RESET_MS };
        return;
      }

      // ─── Single-key shortcuts ────────────────────────────────
      if (e.key === '/') {
        e.preventDefault();
        handlersRef.current.onFocusSearch();
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        handlersRef.current.onShowHelp();
        return;
      }
    }

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);
}
