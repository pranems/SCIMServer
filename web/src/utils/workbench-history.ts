/**
 * Phase M1 - workbench-history (pure localStorage ring buffer).
 *
 * The Workbench is the SCIMServer "the killer feature" per
 * [docs/UI_NEXT_GAPS_LATERAL_ANALYSIS_2026.md S4.2]. Operators send
 * arbitrary SCIM requests through it; this module keeps the last 50
 * requests + responses persisted across sessions so the operator can
 * answer "what did I just do?" or rerun a request from yesterday.
 *
 * Newest-first ordering. Cap at 50 entries (oldest dropped). Corrupt
 * storage payload returns an empty array (no throw) so a bad write
 * cannot brick the page.
 *
 * @see web/src/utils/workbench-history.test.ts (TDD spec)
 * @see docs/PHASE_M1_SCIM_WORKBENCH.md
 */

export const WORKBENCH_HISTORY_KEY = 'scimserver.workbench.history.v1';
export const MAX_HISTORY = 50;

export interface WorkbenchHistoryEntry {
  /** Stable per-entry id (uuid or timestamp-based). */
  id: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  /** Server X-Request-Id when present (for cross-referencing /admin/logs). */
  requestId?: string;
  /** ISO timestamp of when the request was issued. */
  timestamp: string;
  /** The body the operator sent. May be undefined for GET / DELETE. */
  requestBody?: unknown;
  /** The body the server returned. May be undefined on 204. */
  responseBody?: unknown;
}

function safeRead(): WorkbenchHistoryEntry[] {
  if (typeof localStorage === 'undefined') return [];
  const raw = localStorage.getItem(WORKBENCH_HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive shape check: only accept entries that at least have
    // the four scalar fields so a bad write cannot pollute the UI.
    return parsed.filter(
      (e) =>
        e !== null &&
        typeof e === 'object' &&
        typeof e.id === 'string' &&
        typeof e.method === 'string' &&
        typeof e.path === 'string' &&
        typeof e.timestamp === 'string',
    ) as WorkbenchHistoryEntry[];
  } catch {
    // Corrupt storage - return empty so the next append silently
    // overwrites the bad payload.
    return [];
  }
}

function safeWrite(entries: WorkbenchHistoryEntry[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(WORKBENCH_HISTORY_KEY, JSON.stringify(entries));
  } catch {
    // Quota / disabled storage - silently swallow. The Workbench
    // continues to work in-memory; only the history persistence is lost.
  }
}

export function loadHistory(): WorkbenchHistoryEntry[] {
  return safeRead();
}

/**
 * Append a new entry. Newest-first means the new entry lands at index 0;
 * the oldest entry is dropped when the buffer hits MAX_HISTORY.
 */
export function appendHistory(entry: WorkbenchHistoryEntry): void {
  const current = safeRead();
  const next = [entry, ...current].slice(0, MAX_HISTORY);
  safeWrite(next);
}

export function clearHistory(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(WORKBENCH_HISTORY_KEY);
  } catch {
    // Same swallow rationale as safeWrite.
  }
}
