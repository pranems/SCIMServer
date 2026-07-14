import { Injectable } from '@nestjs/common';
import type { AuthDecisionTrace } from './auth-decision-trace';

/**
 * WI-D5: a short-TTL, admin-only, in-memory store of recent Auth Decision
 * Records (the WI-D3 traces). It powers the two-scope admin query surface
 * (per-endpoint `GET /scim/admin/endpoints/:id/auth-decisions` + global
 * `GET /scim/admin/auth-decisions`) that the WI-D6 diagnostics UI renders.
 *
 * The trace IS the record - it already carries only non-secret identifiers
 * (the WI-D3 builder sanitizes decoded claims + jose header; the raw assertion
 * and any bearer token are never present). This store adds a `recordedAt`
 * timestamp + a monotonic id, keeps a bounded ring of the most-recent records,
 * and evicts anything older than the TTL on every access, so it is a
 * best-effort recent-diagnostics buffer, NOT an audit log (the persisted
 * RequestLog + the WI-D4 `Auth decision` log events are the durable record).
 */
export interface AuthDecisionRecord extends AuthDecisionTrace {
  /** Monotonic id, unique within the process lifetime. */
  id: string;
  /** ISO timestamp the record was captured. */
  recordedAt: string;
}

export interface AuthDecisionQuery {
  endpointId?: string;
  outcome?: 'accept' | 'reject';
  reasonCode?: string;
  limit?: number;
}

const DEFAULT_MAX_RECORDS = 500;
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

@Injectable()
export class AuthDecisionRecordStore {
  private readonly records: AuthDecisionRecord[] = [];
  private seq = 0;
  private readonly maxRecords: number;
  private readonly ttlMs: number;

  constructor() {
    const cfgMax = Number(process.env.AUTH_DECISION_STORE_MAX);
    this.maxRecords = Number.isFinite(cfgMax) && cfgMax > 0 ? cfgMax : DEFAULT_MAX_RECORDS;
    const cfgTtl = Number(process.env.AUTH_DECISION_STORE_TTL_MS);
    this.ttlMs = Number.isFinite(cfgTtl) && cfgTtl > 0 ? cfgTtl : DEFAULT_TTL_MS;
  }

  /** Capture a trace as a recent Auth Decision Record. */
  record(trace: AuthDecisionTrace): AuthDecisionRecord {
    const rec: AuthDecisionRecord = {
      ...trace,
      id: `adr_${(++this.seq).toString(36)}_${Date.now().toString(36)}`,
      recordedAt: new Date().toISOString(),
    };
    this.records.push(rec);
    if (this.records.length > this.maxRecords) {
      this.records.splice(0, this.records.length - this.maxRecords);
    }
    return rec;
  }

  /**
   * Query the recent records, newest first. Prunes expired records first, then
   * filters by endpoint / outcome / reasonCode and caps to `limit` (default 50).
   */
  query(q: AuthDecisionQuery = {}): AuthDecisionRecord[] {
    this.prune();
    let out = [...this.records].reverse();
    if (q.endpointId) out = out.filter((r) => r.endpointId === q.endpointId);
    if (q.outcome) out = out.filter((r) => r.outcome === q.outcome);
    if (q.reasonCode) out = out.filter((r) => r.reasonCode === q.reasonCode);
    const limit = q.limit && q.limit > 0 ? q.limit : 50;
    return out.slice(0, limit);
  }

  /** Current record count after pruning (test/observability helper). */
  size(): number {
    this.prune();
    return this.records.length;
  }

  /**
   * WI-D8: the single most-recent decision per auth method for one endpoint,
   * keyed by the trace `method` (`wif` / `oauth_client` / `shared_secret` /
   * `bearer_jwt`). Powers the connection-info `authHealth` per-method chip. The
   * caller maps the method key onto its own `ConnectionMethod` vocabulary.
   */
  latestByMethodForEndpoint(endpointId: string): Record<string, AuthDecisionRecord> {
    this.prune();
    const out: Record<string, AuthDecisionRecord> = {};
    // records are chronological; walk newest-first and keep the first per method.
    for (let i = this.records.length - 1; i >= 0; i--) {
      const rec = this.records[i];
      if (rec.endpointId !== endpointId) continue;
      if (!out[rec.method]) out[rec.method] = rec;
    }
    return out;
  }

  /** Clear all records (test helper). */
  clear(): void {
    this.records.length = 0;
  }

  /** Evict records older than the TTL. */
  private prune(): void {
    const cutoff = Date.now() - this.ttlMs;
    let removeCount = 0;
    for (const rec of this.records) {
      if (new Date(rec.recordedAt).getTime() < cutoff) removeCount++;
      else break; // records are in insertion (chronological) order
    }
    if (removeCount > 0) this.records.splice(0, removeCount);
  }
}
