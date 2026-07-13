import { AuthDecisionRecordStore } from './auth-decision-record.store';
import type { AuthDecisionTrace } from './auth-decision-trace';

function trace(overrides: Partial<AuthDecisionTrace> = {}): AuthDecisionTrace {
  return {
    plane: 'token-mint',
    method: 'wif',
    outcome: 'reject',
    reasonCode: 'wif_audience_mismatch',
    endpointId: 'ep-1',
    correlationId: 'req-1',
    checks: [{ id: 'audience_match', status: 'fail' }],
    ...overrides,
  };
}

describe('WI-D5 AuthDecisionRecordStore', () => {
  let store: AuthDecisionRecordStore;

  beforeEach(() => {
    store = new AuthDecisionRecordStore();
  });

  it('records a trace with a generated id + recordedAt timestamp', () => {
    const rec = store.record(trace());
    expect(rec.id).toMatch(/^adr_/);
    expect(typeof rec.recordedAt).toBe('string');
    expect(rec.reasonCode).toBe('wif_audience_mismatch');
    expect(store.size()).toBe(1);
  });

  it('returns records newest-first', () => {
    store.record(trace({ correlationId: 'req-1' }));
    store.record(trace({ correlationId: 'req-2' }));
    const out = store.query();
    expect(out[0].correlationId).toBe('req-2');
    expect(out[1].correlationId).toBe('req-1');
  });

  it('filters by endpointId', () => {
    store.record(trace({ endpointId: 'ep-a' }));
    store.record(trace({ endpointId: 'ep-b' }));
    const out = store.query({ endpointId: 'ep-b' });
    expect(out).toHaveLength(1);
    expect(out[0].endpointId).toBe('ep-b');
  });

  it('filters by outcome', () => {
    store.record(trace({ outcome: 'accept', reasonCode: undefined }));
    store.record(trace({ outcome: 'reject' }));
    expect(store.query({ outcome: 'accept' })).toHaveLength(1);
    expect(store.query({ outcome: 'reject' })).toHaveLength(1);
  });

  it('filters by reasonCode', () => {
    store.record(trace({ reasonCode: 'wif_issuer_mismatch' }));
    store.record(trace({ reasonCode: 'wif_audience_mismatch' }));
    const out = store.query({ reasonCode: 'wif_issuer_mismatch' });
    expect(out).toHaveLength(1);
    expect(out[0].reasonCode).toBe('wif_issuer_mismatch');
  });

  it('caps the result set to the requested limit', () => {
    for (let i = 0; i < 10; i++) store.record(trace({ correlationId: `req-${i}` }));
    expect(store.query({ limit: 3 })).toHaveLength(3);
  });

  it('bounds the ring to AUTH_DECISION_STORE_MAX (evicts oldest)', () => {
    const bounded = new AuthDecisionRecordStore();
    // Default max is 500; push 505 and confirm only 500 remain, oldest evicted.
    for (let i = 0; i < 505; i++) bounded.record(trace({ correlationId: `req-${i}` }));
    expect(bounded.size()).toBe(500);
    const all = bounded.query({ limit: 1000 });
    expect(all[all.length - 1].correlationId).toBe('req-5'); // req-0..req-4 evicted
  });

  it('prunes records older than the TTL', () => {
    process.env.AUTH_DECISION_STORE_TTL_MS = '50';
    const shortTtl = new AuthDecisionRecordStore();
    const rec = shortTtl.record(trace());
    // Force the record to look old by rewriting its recordedAt.
    (rec as { recordedAt: string }).recordedAt = new Date(Date.now() - 1000).toISOString();
    expect(shortTtl.size()).toBe(0);
    delete process.env.AUTH_DECISION_STORE_TTL_MS;
  });

  it('never stores a raw assertion (only the sanitized trace fields it is given)', () => {
    const rec = store.record(trace({ decodedClaims: { iss: 'issuer-a' } }));
    expect(rec.decodedClaims).toEqual({ iss: 'issuer-a' });
    expect(JSON.stringify(store.query())).not.toContain('signature');
  });

  it('clear() empties the store', () => {
    store.record(trace());
    store.clear();
    expect(store.size()).toBe(0);
  });
});
