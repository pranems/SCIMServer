import {
  AuthDecisionTraceBuilder,
  mapJwksErrorToReason,
  describeTraceReason,
  emitAuthDecisionEvent,
  AUTH_DECISION_EVENT,
  type AuthDecisionTrace,
} from './auth-decision-trace';

describe('WI-D3 AuthDecisionTrace', () => {
  it('builds an accept trace with passing checks and no reason code', () => {
    const trace = new AuthDecisionTraceBuilder('token-mint', 'wif', {
      correlationId: 'req-1',
      endpointId: 'ep-1',
    })
      .pass('jwks_signature')
      .pass('issuer_match', { expected: 'iss-a' })
      .accept()
      .build();

    expect(trace.outcome).toBe('accept');
    expect(trace.reasonCode).toBeUndefined();
    expect(trace.correlationId).toBe('req-1');
    expect(trace.endpointId).toBe('ep-1');
    expect(trace.checks).toHaveLength(2);
  });

  it('builds a reject trace with a catalog reason code', () => {
    const trace = new AuthDecisionTraceBuilder('token-mint', 'wif')
      .pass('jwks_signature')
      .fail('audience_match', { expected: 'api://a', received: 'api://b' })
      .reject('wif_audience_mismatch')
      .build();

    expect(trace.outcome).toBe('reject');
    expect(trace.reasonCode).toBe('wif_audience_mismatch');
    expect(trace.checks.find((c) => c.status === 'fail')?.id).toBe('audience_match');
  });

  it('degrades an unknown reason code to undefined (only catalog codes recorded)', () => {
    const trace = new AuthDecisionTraceBuilder('token-mint', 'oauth_client')
      .reject('not_a_real_code')
      .build();
    expect(trace.reasonCode).toBeUndefined();
  });

  it('sanitizes decoded claims to non-secret identifiers only', () => {
    const trace = new AuthDecisionTraceBuilder('token-mint', 'wif')
      .setDecodedClaims({
        iss: 'issuer',
        sub: 'subject',
        aud: 'aud',
        tid: 'tenant',
        roles: ['R'],
        client_secret: 'SHOULD_NOT_APPEAR',
        password: 'SHOULD_NOT_APPEAR',
      })
      .reject('wif_issuer_mismatch')
      .build();

    expect(trace.decodedClaims?.iss).toBe('issuer');
    expect(trace.decodedClaims?.roles).toEqual(['R']);
    expect(JSON.stringify(trace)).not.toContain('SHOULD_NOT_APPEAR');
  });

  it('sanitizes the jose header to alg/kid/typ only', () => {
    const trace = new AuthDecisionTraceBuilder('token-mint', 'wif')
      .setJoseHeader({ alg: 'RS256', kid: 'k1', x5c: ['SHOULD_NOT_APPEAR'] })
      .reject('assertion_signature_invalid')
      .build();
    expect(trace.joseHeader?.alg).toBe('RS256');
    expect(trace.joseHeader?.kid).toBe('k1');
    expect(JSON.stringify(trace)).not.toContain('SHOULD_NOT_APPEAR');
  });

  it('carries multi-trust sub-traces', () => {
    const sub = new AuthDecisionTraceBuilder('token-mint', 'wif')
      .fail('issuer_match')
      .reject('wif_issuer_mismatch')
      .build();
    const trace = new AuthDecisionTraceBuilder('token-mint', 'wif')
      .reject('wif_no_trust_accepted')
      .build([sub]);
    expect(trace.subTraces).toHaveLength(1);
    expect(trace.subTraces?.[0].reasonCode).toBe('wif_issuer_mismatch');
  });

  describe('mapJwksErrorToReason', () => {
    it('maps jose ERR_JWT_EXPIRED to assertion_expired', () => {
      expect(mapJwksErrorToReason(Object.assign(new Error('exp'), { code: 'ERR_JWT_EXPIRED' }))).toBe(
        'assertion_expired',
      );
    });
    it('maps jose ERR_JOSE_ALG_NOT_ALLOWED to assertion_alg_not_allowed', () => {
      expect(
        mapJwksErrorToReason(Object.assign(new Error('alg'), { code: 'ERR_JOSE_ALG_NOT_ALLOWED' })),
      ).toBe('assertion_alg_not_allowed');
    });
    it('maps jose ERR_JWS_SIGNATURE_VERIFICATION_FAILED to assertion_signature_invalid', () => {
      expect(
        mapJwksErrorToReason(
          Object.assign(new Error('sig'), { code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' }),
        ),
      ).toBe('assertion_signature_invalid');
    });
    it('maps the allowlist message to jwks_host_not_allowlisted', () => {
      expect(
        mapJwksErrorToReason(new Error('JWKS host "evil.com" is not permitted by the JWKS_HOST_ALLOWLIST.')),
      ).toBe('jwks_host_not_allowlisted');
    });
    it('maps the https-scheme message to jwks_scheme_not_https', () => {
      expect(mapJwksErrorToReason(new Error('jwksUri must use https (got "http:").'))).toBe(
        'jwks_scheme_not_https',
      );
    });
    it('maps a fetch outage message to jwks_unreachable', () => {
      expect(mapJwksErrorToReason(new Error('JWKS unavailable; failing closed.'))).toBe('jwks_unreachable');
    });
    it('falls back to assertion_signature_invalid for an unclassifiable error', () => {
      expect(mapJwksErrorToReason(new Error('something weird'))).toBe('assertion_signature_invalid');
    });
  });

  it('describeTraceReason resolves the catalog entry for the trace reason', () => {
    const entry = describeTraceReason({ reasonCode: 'wif_audience_mismatch' });
    expect(entry?.wireError).toBe('invalid_client');
    expect(entry?.plane).toBe('wif');
  });

  describe('WI-D4 emitAuthDecisionEvent', () => {
    const makeLogger = () => ({ info: jest.fn(), warn: jest.fn() });

    it('emits exactly one INFO event on accept with the AUTH_DECISION_EVENT message', () => {
      const logger = makeLogger();
      const trace: AuthDecisionTrace = {
        plane: 'token-mint',
        method: 'wif',
        outcome: 'accept',
        endpointId: 'ep-1',
        correlationId: 'req-1',
        checks: [{ id: 'jwks_signature', status: 'pass' }],
      };
      emitAuthDecisionEvent(logger, trace, 'AUTH');
      expect(logger.info).toHaveBeenCalledTimes(1);
      expect(logger.warn).not.toHaveBeenCalled();
      const [category, message, data] = logger.info.mock.calls[0];
      expect(category).toBe('AUTH');
      expect(message).toBe(AUTH_DECISION_EVENT);
      expect(data.outcome).toBe('accept');
      expect(data.method).toBe('wif');
      expect(data.endpointId).toBe('ep-1');
      expect(data.correlationId).toBe('req-1');
    });

    it('emits exactly one WARN event on reject with the reason code + failed check ids', () => {
      const logger = makeLogger();
      const trace: AuthDecisionTrace = {
        plane: 'token-mint',
        method: 'wif',
        outcome: 'reject',
        reasonCode: 'wif_audience_mismatch',
        checks: [
          { id: 'jwks_signature', status: 'pass' },
          { id: 'audience_match', status: 'fail', expected: 'api://a', received: 'api://b' },
        ],
      };
      emitAuthDecisionEvent(logger, trace, 'AUTH');
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.info).not.toHaveBeenCalled();
      const data = logger.warn.mock.calls[0][2];
      expect(data.reasonCode).toBe('wif_audience_mismatch');
      expect(data.failedChecks).toEqual(['audience_match']);
      expect(data.checkCount).toBe(2);
    });

    it('does not leak the raw assertion or received values beyond the sanitized trace', () => {
      const logger = makeLogger();
      const trace: AuthDecisionTrace = {
        plane: 'token-mint',
        method: 'wif',
        outcome: 'reject',
        reasonCode: 'wif_issuer_mismatch',
        decodedClaims: { iss: 'issuer-a' },
        checks: [],
      };
      emitAuthDecisionEvent(logger, trace, 'AUTH');
      const data = logger.warn.mock.calls[0][2];
      expect(data.decodedClaims).toEqual({ iss: 'issuer-a' });
      expect(JSON.stringify(data)).not.toContain('signature');
    });

    it('drops undefined keys so the log line stays clean', () => {
      const logger = makeLogger();
      const trace: AuthDecisionTrace = {
        plane: 'token-mint',
        method: 'oauth_client',
        outcome: 'reject',
        reasonCode: 'oauth_client_auth_failed',
        checks: [],
      };
      emitAuthDecisionEvent(logger, trace, 'AUTH');
      const data = logger.warn.mock.calls[0][2];
      expect('selectedTrustId' in data).toBe(false);
      expect('endpointId' in data).toBe(false);
    });
  });
});

