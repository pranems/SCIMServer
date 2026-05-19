/**
 * Phase M1 - workbench-history pure module tests.
 *
 * Ring buffer of the last 50 SCIM requests issued from the Workbench,
 * persisted to localStorage so the operator can revisit / re-run
 * yesterday`s exploration on tomorrow`s session.
 *
 * Properties under test:
 *   1. Empty load on first run (storage absent)
 *   2. Round-trip: append + load returns the same entry
 *   3. Newest-first ordering (most recent at index 0)
 *   4. Cap at MAX_HISTORY (50) - oldest entry is dropped
 *   5. Clear empties storage
 *   6. Corrupt storage -> graceful empty (no throw)
 *   7. Each entry has the documented shape (id, method, path, status,
 *      durationMs, requestId, timestamp, requestBody, responseBody)
 *   8. Storage key is the documented constant
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadHistory,
  appendHistory,
  clearHistory,
  WORKBENCH_HISTORY_KEY,
  MAX_HISTORY,
  type WorkbenchHistoryEntry,
} from './workbench-history';

function sample(overrides: Partial<WorkbenchHistoryEntry> = {}): WorkbenchHistoryEntry {
  return {
    id: 'wb-1',
    method: 'GET',
    path: '/scim/endpoints/ep-1/Users',
    status: 200,
    durationMs: 42,
    requestId: 'req-abc',
    timestamp: '2026-05-15T10:00:00.000Z',
    requestBody: undefined,
    responseBody: { totalResults: 0, Resources: [] },
    ...overrides,
  };
}

describe('Phase M1 - workbench-history (pure localStorage ring buffer)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('exposes the documented constants', () => {
    expect(WORKBENCH_HISTORY_KEY).toBe('scimserver.workbench.history.v1');
    expect(MAX_HISTORY).toBe(50);
  });

  it('loadHistory returns an empty array when storage is empty', () => {
    expect(loadHistory()).toEqual([]);
  });

  it('appendHistory + loadHistory round-trips the entry', () => {
    const entry = sample({ id: 'wb-1', method: 'POST' });
    appendHistory(entry);
    const loaded = loadHistory();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('wb-1');
    expect(loaded[0].method).toBe('POST');
  });

  it('newest entry lands at index 0 (newest-first ordering)', () => {
    appendHistory(sample({ id: 'wb-1', timestamp: '2026-05-15T10:00:00.000Z' }));
    appendHistory(sample({ id: 'wb-2', timestamp: '2026-05-15T10:00:01.000Z' }));
    appendHistory(sample({ id: 'wb-3', timestamp: '2026-05-15T10:00:02.000Z' }));
    const loaded = loadHistory();
    expect(loaded.map((e) => e.id)).toEqual(['wb-3', 'wb-2', 'wb-1']);
  });

  it('caps at MAX_HISTORY entries; oldest gets dropped', () => {
    for (let i = 0; i < MAX_HISTORY + 5; i++) {
      appendHistory(sample({ id: `wb-${i}` }));
    }
    const loaded = loadHistory();
    expect(loaded).toHaveLength(MAX_HISTORY);
    // Newest-first: the just-appended `wb-${MAX_HISTORY+4}` should be first;
    // the oldest five (wb-0..wb-4) should be gone.
    expect(loaded[0].id).toBe(`wb-${MAX_HISTORY + 4}`);
    expect(loaded.find((e) => e.id === 'wb-0')).toBeUndefined();
    expect(loaded.find((e) => e.id === 'wb-4')).toBeUndefined();
    expect(loaded.find((e) => e.id === 'wb-5')).toBeDefined();
  });

  it('clearHistory empties storage', () => {
    appendHistory(sample({ id: 'wb-1' }));
    appendHistory(sample({ id: 'wb-2' }));
    expect(loadHistory()).toHaveLength(2);
    clearHistory();
    expect(loadHistory()).toEqual([]);
  });

  it('corrupt storage payload returns an empty array (no throw)', () => {
    localStorage.setItem(WORKBENCH_HISTORY_KEY, 'this is not JSON {{{');
    expect(loadHistory()).toEqual([]);
  });

  it('non-array JSON returns an empty array (no throw)', () => {
    localStorage.setItem(WORKBENCH_HISTORY_KEY, '{"not":"an array"}');
    expect(loadHistory()).toEqual([]);
  });

  it('appendHistory still works after a load-failure (auto-recovery)', () => {
    localStorage.setItem(WORKBENCH_HISTORY_KEY, 'corrupt');
    appendHistory(sample({ id: 'wb-1' }));
    const loaded = loadHistory();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('wb-1');
  });
});
