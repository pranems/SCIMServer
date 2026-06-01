/**
 * useCopyToClipboard - small hook that wraps navigator.clipboard.writeText
 * with a 'copied' visual-feedback state that auto-resets after a short
 * delay. Centralises the pattern that was previously hand-rolled in
 * CredentialsTab + SchemasTab + DiscoveryExplorerPage so every copy
 * affordance across the UI behaves identically.
 *
 * Status transitions:
 *   idle -> copied  (success path; resets to idle after 1500ms)
 *   idle -> error   (clipboard write rejected; resets to idle after 1500ms)
 *
 * The hook is SSR-safe (returns a no-op until navigator is defined) and
 * test-safe (the reset timer is cleared on unmount).
 */
import * as React from 'react';

export type CopyStatus = 'idle' | 'copied' | 'error';

export interface UseCopyToClipboardResult {
  copy: (text: string) => Promise<void>;
  status: CopyStatus;
  reset: () => void;
}

const RESET_AFTER_MS = 1500;

export function useCopyToClipboard(): UseCopyToClipboardResult {
  const [status, setStatus] = React.useState<CopyStatus>('idle');
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const scheduleReset = React.useCallback((): void => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setStatus('idle'), RESET_AFTER_MS);
  }, []);

  const copy = React.useCallback(
    async (text: string): Promise<void> => {
      if (typeof navigator === 'undefined' || !navigator.clipboard) {
        setStatus('error');
        scheduleReset();
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        setStatus('copied');
        scheduleReset();
      } catch {
        setStatus('error');
        scheduleReset();
      }
    },
    [scheduleReset],
  );

  const reset = React.useCallback((): void => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setStatus('idle');
  }, []);

  return { copy, status, reset };
}
