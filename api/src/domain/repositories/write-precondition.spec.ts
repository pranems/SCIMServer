import {
  assertWritePrecondition, observeWriteVersion, resourceWriteVersion, resourceWriteWhere, writeMissError,
} from './write-precondition';

describe('observed resource version and independent client precondition', () => {
  it.each([undefined, '*', 10] as const)('binds all final predicate fields with condition %s', condition => {
    const scope = { endpointId: 'endpoint', resourceType: 'Group' };
    const expected = observeWriteVersion(10, condition, scope);
    expect(resourceWriteWhere('resource', expected)).toEqual({ id: 'resource', version: 10, ...scope });
    expect(() => assertWritePrecondition({ version: 10, ...scope }, expected)).not.toThrow();
  });

  it('copies the observed scope instead of retaining a mutable caller object', () => {
    const scope = { endpointId: 'endpoint', resourceType: 'Group' };
    const expected = observeWriteVersion(10, undefined, scope);
    scope.endpointId = 'changed';
    expect(resourceWriteWhere('resource', expected)).toEqual({
      id: 'resource', version: 10, endpointId: 'endpoint', resourceType: 'Group',
    });
  });

  it.each([
    { endpointId: 'other', resourceType: 'Group' },
    { endpointId: 'endpoint', resourceType: 'User' },
  ])('rejects a matching version under a different observed scope %j', scope => {
    const expected = { observedVersion: 10, scope };
    expect(() => assertWritePrecondition({
      version: 10, endpointId: 'endpoint', resourceType: 'Group',
    }, expected)).toThrow(expect.objectContaining({ code: 'WRITE_CONFLICT' }));
  });

  it.each([undefined, '*', 10] as const)('uses the observed version for final CAS with client condition %s', condition => {
    expect(resourceWriteVersion(observeWriteVersion(10, condition))).toBe(10);
    expect(() => assertWritePrecondition({ version: 10 }, observeWriteVersion(10, condition))).not.toThrow();
  });

  it.each([undefined, '*'] as const)('rejects an existing changed resource as a conflict, not a failed %s condition', condition => {
    expect(() => assertWritePrecondition({ version: 11 }, observeWriteVersion(10, condition)))
      .toThrow(expect.objectContaining({ code: 'WRITE_CONFLICT' }));
  });

  it('keeps a numeric client mismatch a precondition failure', () => {
    expect(() => assertWritePrecondition({ version: 11 }, observeWriteVersion(10, 10)))
      .toThrow(expect.objectContaining({ code: 'PRECONDITION_FAILED' }));
  });

  it.each(['*', 10] as const)('keeps disappearance a failed explicit %s condition', condition => {
    expect(() => assertWritePrecondition(undefined, observeWriteVersion(10, condition)))
      .toThrow(expect.objectContaining({ code: 'PRECONDITION_FAILED' }));
  });

  it('reports disappearance after an unconditioned snapshot as a write conflict', () => {
    expect(() => assertWritePrecondition(undefined, observeWriteVersion(10)))
      .toThrow(expect.objectContaining({ code: 'WRITE_CONFLICT' }));
  });

  it('preserves scalar precondition compatibility and explicit numeric final failures', () => {
    expect(resourceWriteVersion('*')).toBeUndefined();
    expect(resourceWriteVersion(10)).toBe(10);
    expect(writeMissError(10).code).toBe('PRECONDITION_FAILED');
    expect(writeMissError(observeWriteVersion(10, 10)).code).toBe('PRECONDITION_FAILED');
    expect(writeMissError().code).toBe('NOT_FOUND');
  });
});
