/**
 * useOnboarding - Phase N2 first-run trigger hook + helpers.
 *
 * Drives whether the <OnboardingWizard /> chrome-level component is
 * rendered. Pure read-side: never owns step state, never owns mutation
 * state - those live inside the wizard component itself.
 *
 * Trigger contract (per docs/PHASE_N2_ONBOARDING_WIZARD.md):
 *
 *   show = forceOpen
 *        OR (!completedAt AND endpoints.totalResults === 0)
 *
 * Where:
 *   - `completedAt` is an ISO-8601 timestamp written by the wizard on
 *     Skip / Send-it-now / Do-this-later / Close. Once written the
 *     wizard never auto-reappears (it can be reopened explicitly from
 *     SettingsPage which clears the flag).
 *   - `forceOpen` is a hidden testing / demo escape hatch. Set
 *     localStorage `scimserver.onboarding.forceOpen=1` to surface the
 *     wizard even on tenants that already have endpoints (used by
 *     SettingsPage's "Show onboarding again" link and by unit tests
 *     that need to assert step transitions without manipulating
 *     endpoint state).
 *
 * Re-evaluation: components subscribe to a custom event
 * `scimserver.onboarding.changed` that the wizard dispatches on
 * every dismiss / reset so the hook re-reads localStorage without
 * relying on the `storage` event (which only fires cross-tab).
 *
 * @see docs/PHASE_N2_ONBOARDING_WIZARD.md
 */
import { useEffect, useState } from 'react';
import { useEndpoints } from '../api/queries';

/** localStorage key for the completed-at flag. */
export const ONBOARDING_COMPLETED_KEY = 'scimserver.onboarding.completedAt';

/** localStorage key for the test / demo force-open flag. */
export const ONBOARDING_FORCE_OPEN_KEY = 'scimserver.onboarding.forceOpen';

/** Custom event name dispatched on dismiss / reset so the hook re-reads. */
export const ONBOARDING_CHANGED_EVENT = 'scimserver.onboarding.changed';

/**
 * Mark the onboarding as completed. Wizard dismiss handlers call this.
 * Idempotent - safe to call multiple times.
 */
export function markOnboardingComplete(): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(ONBOARDING_COMPLETED_KEY, new Date().toISOString());
  localStorage.removeItem(ONBOARDING_FORCE_OPEN_KEY);
  window.dispatchEvent(new CustomEvent(ONBOARDING_CHANGED_EVENT));
}

/**
 * Reset the onboarding flag so the wizard re-appears on next render.
 * SettingsPage's "Show onboarding again" link calls this.
 */
export function resetOnboarding(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(ONBOARDING_COMPLETED_KEY);
  localStorage.setItem(ONBOARDING_FORCE_OPEN_KEY, '1');
  window.dispatchEvent(new CustomEvent(ONBOARDING_CHANGED_EVENT));
}

/**
 * Returns true when the OnboardingWizard should render.
 *
 * The hook subscribes to a custom-event re-eval signal AND the
 * useEndpoints query state so it reacts to both manual dismiss and
 * the operator creating their first endpoint mid-wizard (the wizard
 * itself drives that mutation, but a separate tab might race).
 */
export function useShowOnboarding(): boolean {
  const endpointsQuery = useEndpoints();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const handler = (): void => setTick((t) => t + 1);
    window.addEventListener(ONBOARDING_CHANGED_EVENT, handler);
    return () => window.removeEventListener(ONBOARDING_CHANGED_EVENT, handler);
  }, []);

  if (typeof window === 'undefined') return false;

  // Force-open beats everything else (testing / demo path).
  if (localStorage.getItem(ONBOARDING_FORCE_OPEN_KEY) === '1') return true;

  // Already completed - never re-show without an explicit reset.
  if (localStorage.getItem(ONBOARDING_COMPLETED_KEY)) return false;

  // While endpoints query is loading or errored, do not flash the
  // wizard - wait for a definitive zero-endpoints answer.
  if (endpointsQuery.isLoading || endpointsQuery.isError) return false;
  if (!endpointsQuery.data) return false;

  // Reference `tick` so the hook re-runs after the change event.
  void tick;

  return endpointsQuery.data.totalResults === 0;
}
