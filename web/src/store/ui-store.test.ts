/**
 * ui-store.test.ts - Phase K2 Zustand slice contract.
 *
 * Locks in the `sseConnectionState` slice so a future PR cannot
 * silently rename it / drop the setter / change the legal value set.
 * useHealthRollup + useSSE both depend on this exact shape.
 *
 * @see docs/PHASE_K2_SERVICE_HEALTH_ROLLUP.md
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore, type SseConnectionState } from './ui-store';

const LEGAL_STATES: SseConnectionState[] = ['connecting', 'open', 'reconnecting', 'closed'];

describe('ui-store - K2 sseConnectionState slice', () => {
  beforeEach(() => {
    // Reset to default between tests (the store does not auto-reset).
    useUIStore.setState({ sseConnectionState: 'closed' });
  });

  it('exposes a sseConnectionState field with default "closed"', () => {
    const state = useUIStore.getState();
    expect(state.sseConnectionState).toBe<SseConnectionState>('closed');
  });

  it('exposes a setSseConnectionState setter that flips the value', () => {
    const { setSseConnectionState } = useUIStore.getState();
    expect(typeof setSseConnectionState).toBe('function');
    setSseConnectionState('open');
    expect(useUIStore.getState().sseConnectionState).toBe('open');
  });

  it.each(LEGAL_STATES)('accepts every legal state value: %s', (state) => {
    useUIStore.getState().setSseConnectionState(state);
    expect(useUIStore.getState().sseConnectionState).toBe(state);
  });
});
