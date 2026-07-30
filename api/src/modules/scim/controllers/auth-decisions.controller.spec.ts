import { AuthDecisionsController } from './auth-decisions.controller';
import { AuthDecisionRecordStore } from '../../../oauth/auth-decision-record.store';
import type { AuthDecisionTrace } from '../../../oauth/auth-decision-trace';

function trace(overrides: Partial<AuthDecisionTrace> = {}): AuthDecisionTrace {
  return {
    plane: 'token-mint',
    method: 'wif',
    outcome: 'reject',
    reasonCode: 'wif_audience_mismatch',
    endpointId: 'ep-1',
    correlationId: 'req-1',
    checks: [],
    ...overrides,
  };
}

describe('WI-D5 AuthDecisionsController', () => {
  let store: AuthDecisionRecordStore;
  let controller: AuthDecisionsController;

  beforeEach(() => {
    store = new AuthDecisionRecordStore();
    controller = new AuthDecisionsController(store);
  });

  it('global scope returns records across all endpoints', () => {
    store.record(trace({ endpointId: 'ep-a' }));
    store.record(trace({ endpointId: 'ep-b' }));
    const res = controller.listGlobal();
    expect(res.count).toBe(2);
    expect(res.records).toHaveLength(2);
  });

  it('per-endpoint scope filters to one endpoint', () => {
    store.record(trace({ endpointId: 'ep-a' }));
    store.record(trace({ endpointId: 'ep-b' }));
    const res = controller.listForEndpoint('ep-b');
    expect(res.count).toBe(1);
    expect(res.records[0].endpointId).toBe('ep-b');
  });

  it('filters by outcome', () => {
    store.record(trace({ outcome: 'accept', reasonCode: undefined }));
    store.record(trace({ outcome: 'reject' }));
    expect(controller.listGlobal('accept').count).toBe(1);
    expect(controller.listGlobal('reject').count).toBe(1);
  });

  it('ignores an invalid outcome value', () => {
    store.record(trace({ outcome: 'accept', reasonCode: undefined }));
    store.record(trace({ outcome: 'reject' }));
    // 'bogus' is not accept|reject -> no outcome filter -> all records.
    expect(controller.listGlobal('bogus').count).toBe(2);
  });

  it('filters by reasonCode', () => {
    store.record(trace({ reasonCode: 'wif_issuer_mismatch' }));
    store.record(trace({ reasonCode: 'wif_audience_mismatch' }));
    const res = controller.listGlobal(undefined, 'wif_issuer_mismatch');
    expect(res.count).toBe(1);
    expect(res.records[0].reasonCode).toBe('wif_issuer_mismatch');
  });

  it('caps the result set to the requested limit', () => {
    for (let i = 0; i < 5; i++) store.record(trace({ correlationId: `req-${i}` }));
    expect(controller.listGlobal(undefined, undefined, '2').count).toBe(2);
  });

  it('per-endpoint scope combines endpoint + outcome + limit filters', () => {
    store.record(trace({ endpointId: 'ep-a', outcome: 'reject' }));
    store.record(trace({ endpointId: 'ep-a', outcome: 'accept', reasonCode: undefined }));
    store.record(trace({ endpointId: 'ep-b', outcome: 'reject' }));
    const res = controller.listForEndpoint('ep-a', 'reject');
    expect(res.count).toBe(1);
    expect(res.records[0].endpointId).toBe('ep-a');
    expect(res.records[0].outcome).toBe('reject');
  });
});
