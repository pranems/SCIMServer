import { Test } from '@nestjs/testing';
import {
  WifAssertionValidatorService,
  WifAssertionInvalidError,
  type WifTrust,
} from './wif-assertion-validator.service';
import { ExternalJwksValidatorService } from './external-jwks-validator.service';
import { ScimLogger } from '../modules/logging/scim-logger.service';

/**
 * Q6.3 - WifAssertionValidatorService unit tests.
 *
 * The Q2 signature/JWKS core is mocked so these tests isolate the WIF CLAIM
 * checks (iss/aud/sub/tid/roles). The real signature + alg-pin + exp/nbf + JWKS
 * fail-closed behavior is covered by external-jwks-validator.service.spec.ts and
 * the Q6 E2E (which uses a real signed assertion).
 */
describe('WifAssertionValidatorService (Q6.3)', () => {
  let service: WifAssertionValidatorService;
  let verify: jest.Mock;

  const TRUST: WifTrust = {
    expectedIssuer: 'https://login.microsoftonline.com/tenant-123/v2.0',
    expectedSubject: 'sp-object-id-abc',
    expectedAudience: 'api://scimserver-endpoint',
    jwksUri: 'https://login.microsoftonline.com/tenant-123/discovery/v2.0/keys',
    allowedTenantId: 'tenant-123',
    requiredRoles: ['Scim.Provision'],
  };

  /** A fully-valid Entra-style payload for TRUST. */
  const goodPayload = () => ({
    iss: TRUST.expectedIssuer,
    sub: TRUST.expectedSubject,
    aud: TRUST.expectedAudience,
    tid: TRUST.allowedTenantId,
    roles: ['Scim.Provision', 'Scim.Read'],
    exp: Math.floor(Date.now() / 1000) + 600,
  });

  beforeEach(async () => {
    verify = jest.fn();
    const moduleRef = await Test.createTestingModule({
      providers: [
        WifAssertionValidatorService,
        { provide: ExternalJwksValidatorService, useValue: { verify } },
        { provide: ScimLogger, useValue: { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(WifAssertionValidatorService);
  });

  it('returns the claims when every check passes', async () => {
    verify.mockResolvedValue({ payload: goodPayload(), protectedHeader: { alg: 'RS256' } });
    const claims = await service.validate('assertion.jwt.value', TRUST);
    expect(claims.iss).toBe(TRUST.expectedIssuer);
    expect(claims.sub).toBe(TRUST.expectedSubject);
  });

  it('delegates the signature/JWKS check to the Q2 validator with the configured jwksUri', async () => {
    verify.mockResolvedValue({ payload: goodPayload(), protectedHeader: { alg: 'RS256' } });
    await service.validate('assertion.jwt.value', TRUST);
    // The 3rd arg is the optional per-endpoint egress overrides (undefined here).
    expect(verify).toHaveBeenCalledWith('assertion.jwt.value', TRUST.jwksUri, undefined);
  });

  it('forwards per-endpoint egress overrides to the Q2 validator', async () => {
    verify.mockResolvedValue({ payload: goodPayload(), protectedHeader: { alg: 'RS256' } });
    const overrides = { timeoutMs: 1200, retries: 1 };
    await service.validate('assertion.jwt.value', TRUST, overrides);
    expect(verify).toHaveBeenCalledWith('assertion.jwt.value', TRUST.jwksUri, overrides);
  });

  it('rejects a wrong issuer', async () => {
    verify.mockResolvedValue({ payload: { ...goodPayload(), iss: 'https://evil.example/v2.0' }, protectedHeader: {} });
    await expect(service.validate('a', TRUST)).rejects.toBeInstanceOf(WifAssertionInvalidError);
  });

  it('rejects a wrong subject', async () => {
    verify.mockResolvedValue({ payload: { ...goodPayload(), sub: 'someone-else' }, protectedHeader: {} });
    await expect(service.validate('a', TRUST)).rejects.toBeInstanceOf(WifAssertionInvalidError);
  });

  it('rejects a wrong audience', async () => {
    verify.mockResolvedValue({ payload: { ...goodPayload(), aud: 'api://other' }, protectedHeader: {} });
    await expect(service.validate('a', TRUST)).rejects.toBeInstanceOf(WifAssertionInvalidError);
  });

  it('accepts an audience array that contains the expected audience', async () => {
    verify.mockResolvedValue({
      payload: { ...goodPayload(), aud: ['api://other', TRUST.expectedAudience] },
      protectedHeader: {},
    });
    const claims = await service.validate('a', TRUST);
    expect(claims.sub).toBe(TRUST.expectedSubject);
  });

  it('rejects a wrong tenant id (cross-tenant isolation)', async () => {
    verify.mockResolvedValue({ payload: { ...goodPayload(), tid: 'tenant-999' }, protectedHeader: {} });
    await expect(service.validate('a', TRUST)).rejects.toBeInstanceOf(WifAssertionInvalidError);
  });

  it('rejects when a required role is missing AND roleEnforcement is enforce', async () => {
    const trust: WifTrust = { ...TRUST, roleEnforcement: 'enforce' };
    verify.mockResolvedValue({ payload: { ...goodPayload(), roles: ['Scim.Read'] }, protectedHeader: {} });
    await expect(service.validate('a', trust)).rejects.toBeInstanceOf(WifAssertionInvalidError);
  });

  it('rejects when the roles claim is absent, roles required, AND roleEnforcement is enforce', async () => {
    const trust: WifTrust = { ...TRUST, roleEnforcement: 'enforce' };
    const p = goodPayload();
    delete (p as Record<string, unknown>).roles;
    verify.mockResolvedValue({ payload: p, protectedHeader: {} });
    await expect(service.validate('a', trust)).rejects.toBeInstanceOf(WifAssertionInvalidError);
  });

  it('ALLOWS a missing required role by default (advisory) so the flow continues', async () => {
    // Default trust has requiredRoles:['Scim.Provision'] but no roleEnforcement.
    verify.mockResolvedValue({ payload: { ...goodPayload(), roles: ['Scim.Read'] }, protectedHeader: {} });
    const claims = await service.validate('a', TRUST);
    // Non-blocking: validation succeeds and returns the claims.
    expect(claims.sub).toBe(TRUST.expectedSubject);
  });

  it('ALLOWS an absent roles claim by default (advisory) even when roles are required', async () => {
    const p = goodPayload();
    delete (p as Record<string, unknown>).roles;
    verify.mockResolvedValue({ payload: p, protectedHeader: {} });
    const claims = await service.validate('a', TRUST);
    expect(claims.sub).toBe(TRUST.expectedSubject);
  });

  it('ALLOWS a missing role under roleEnforcement:shadow (log-only, not enforce)', async () => {
    const trust: WifTrust = { ...TRUST, roleEnforcement: 'shadow' };
    verify.mockResolvedValue({ payload: { ...goodPayload(), roles: [] }, protectedHeader: {} });
    const claims = await service.validate('a', trust);
    expect(claims.sub).toBe(TRUST.expectedSubject);
  });

  it('does not require roles when requiredRoles is empty', async () => {
    const trust: WifTrust = { ...TRUST, requiredRoles: [] };
    const p = goodPayload();
    delete (p as Record<string, unknown>).roles;
    verify.mockResolvedValue({ payload: p, protectedHeader: {} });
    const claims = await service.validate('a', trust);
    expect(claims.sub).toBe(TRUST.expectedSubject);
  });

  it('propagates a signature/expiry failure from the Q2 validator (fail closed)', async () => {
    verify.mockRejectedValue(new Error('"exp" claim timestamp check failed'));
    await expect(service.validate('a', TRUST)).rejects.toThrow();
  });

  // WI-D3 - the rejection carries a catalog reason code + a decision trace.
  async function rejectionOf(payload: Record<string, unknown>, trust: WifTrust = TRUST) {
    verify.mockResolvedValue({ payload, protectedHeader: { alg: 'RS256', kid: 'k1' } });
    try {
      await service.validate('a', trust);
      throw new Error('expected rejection');
    } catch (err) {
      return err as WifAssertionInvalidError;
    }
  }

  it('WI-D3: issuer mismatch carries reasonCode wif_issuer_mismatch + a trace', async () => {
    const err = await rejectionOf({ ...goodPayload(), iss: 'https://evil.example/v2.0' });
    expect(err).toBeInstanceOf(WifAssertionInvalidError);
    expect(err.reasonCode).toBe('wif_issuer_mismatch');
    expect(err.trace?.outcome).toBe('reject');
    expect(err.trace?.reasonCode).toBe('wif_issuer_mismatch');
    // The failing check is recorded with expected/received (non-secret).
    const failed = err.trace?.checks.find((c) => c.status === 'fail');
    expect(failed?.id).toBe('issuer_match');
    expect(failed?.expected).toBe(TRUST.expectedIssuer);
  });

  it('WI-D3: audience mismatch carries reasonCode wif_audience_mismatch', async () => {
    const err = await rejectionOf({ ...goodPayload(), aud: 'api://other' });
    expect(err.reasonCode).toBe('wif_audience_mismatch');
  });

  it('WI-D3: tenant mismatch carries reasonCode wif_tenant_mismatch', async () => {
    const err = await rejectionOf({ ...goodPayload(), tid: 'tenant-999' });
    expect(err.reasonCode).toBe('wif_tenant_mismatch');
  });

  it('WI-D3: enforce-mode missing role carries reasonCode wif_missing_role', async () => {
    const err = await rejectionOf({ ...goodPayload(), roles: ['Scim.Read'] }, { ...TRUST, roleEnforcement: 'enforce' });
    expect(err.reasonCode).toBe('wif_missing_role');
  });

  it('WI-D3: a signature failure maps to a signature-plane reason code', async () => {
    verify.mockRejectedValue(new Error('signature verification failed'));
    try {
      await service.validate('a', TRUST);
      throw new Error('expected rejection');
    } catch (err) {
      expect(err).toBeInstanceOf(WifAssertionInvalidError);
      expect((err as WifAssertionInvalidError).reasonCode).toBe('assertion_signature_invalid');
    }
  });

  it('WI-D3: the trace records the decoded non-secret claims + jose header, not the raw token', async () => {
    const err = await rejectionOf({ ...goodPayload(), sub: 'someone-else' });
    expect(err.trace?.decodedClaims?.iss).toBe(TRUST.expectedIssuer);
    expect(err.trace?.joseHeader?.alg).toBe('RS256');
    // The trace never carries the assertion string itself.
    expect(JSON.stringify(err.trace)).not.toContain('a.b.c');
  });

  // WI-D7 - the debugger dry-run: never mints, never throws, always a trace.
  describe('debug() dry-run (WI-D7)', () => {
    it('returns outcome accept + an accept trace when every check passes', async () => {
      verify.mockResolvedValue({ payload: goodPayload(), protectedHeader: { alg: 'RS256', kid: 'k1' } });
      const result = await service.debug('assertion.jwt.value', TRUST);
      expect(result.outcome).toBe('accept');
      expect(result.trace.outcome).toBe('accept');
      expect(result.reasonCode).toBeUndefined();
      // Decoded non-secret claims are surfaced for the operator diff.
      expect(result.trace.decodedClaims?.iss).toBe(TRUST.expectedIssuer);
    });

    it('returns outcome reject + reasonCode + trace on an issuer mismatch, WITHOUT throwing', async () => {
      verify.mockResolvedValue({
        payload: { ...goodPayload(), iss: 'https://evil.example/v2.0' },
        protectedHeader: { alg: 'RS256' },
      });
      const result = await service.debug('a', TRUST);
      expect(result.outcome).toBe('reject');
      expect(result.reasonCode).toBe('wif_issuer_mismatch');
      expect(result.trace.reasonCode).toBe('wif_issuer_mismatch');
      const failed = result.trace.checks.find((c) => c.status === 'fail');
      expect(failed?.id).toBe('issuer_match');
    });

    it('returns outcome reject on a signature failure without leaking the raw assertion', async () => {
      verify.mockRejectedValue(new Error('signature verification failed'));
      const result = await service.debug('a.b.c', TRUST);
      expect(result.outcome).toBe('reject');
      expect(result.reasonCode).toBe('assertion_signature_invalid');
      expect(JSON.stringify(result.trace)).not.toContain('a.b.c');
    });
  });

  // Phase 1 (auth observability) - every PASS check must carry BOTH expected
  // AND received so the diagnostics table never shows a "-" for a passing
  // check. On a pass, received == the actual value that matched.
  describe('Phase 1: pass checks carry expected + received', () => {
    it('the accept trace populates received on EVERY passing claim check', async () => {
      verify.mockResolvedValue({ payload: goodPayload(), protectedHeader: { alg: 'RS256', kid: 'k1' } });
      const { trace } = await service.validateWithTrace('assertion.jwt.value', TRUST);
      expect(trace.outcome).toBe('accept');
      const byId = Object.fromEntries(trace.checks.map((c) => [c.id, c]));
      // Each passing check shows expected AND the matched received value.
      expect(byId['issuer_match'].expected).toBe(TRUST.expectedIssuer);
      expect(byId['issuer_match'].received).toBe(TRUST.expectedIssuer);
      expect(byId['subject_match'].received).toBe(TRUST.expectedSubject);
      expect(byId['audience_match'].received).toBe(TRUST.expectedAudience);
      expect(byId['tenant_match'].received).toBe(TRUST.allowedTenantId);
      expect(byId['jwks_signature'].received).toBeDefined();
      // No passing check leaves received undefined.
      for (const c of trace.checks) {
        if (c.status === 'pass') expect(c.received).toBeDefined();
      }
    });

    it('validateWithTrace returns the SAME claims validate() returns, plus the full trace', async () => {
      verify.mockResolvedValue({ payload: goodPayload(), protectedHeader: { alg: 'RS256' } });
      const { claims, trace } = await service.validateWithTrace('a', TRUST);
      expect(claims.sub).toBe(TRUST.expectedSubject);
      expect(trace.checks.length).toBeGreaterThanOrEqual(4);
      expect(trace.decodedClaims?.iss).toBe(TRUST.expectedIssuer);
    });

    it('debug() reuses the full validator trace on accept (not a 2-check summary)', async () => {
      verify.mockResolvedValue({ payload: goodPayload(), protectedHeader: { alg: 'RS256' } });
      const result = await service.debug('a', TRUST);
      expect(result.outcome).toBe('accept');
      // The real trace has the per-claim checks, each with received populated.
      const ids = result.trace.checks.map((c) => c.id);
      expect(ids).toContain('issuer_match');
      expect(ids).toContain('audience_match');
      const aud = result.trace.checks.find((c) => c.id === 'audience_match');
      expect(aud?.received).toBe(TRUST.expectedAudience);
    });

    it('a passing required_roles check shows the matched roles as received', async () => {
      verify.mockResolvedValue({ payload: goodPayload(), protectedHeader: { alg: 'RS256' } });
      const { trace } = await service.validateWithTrace('a', TRUST);
      const roles = trace.checks.find((c) => c.id === 'required_roles');
      expect(roles?.status).toBe('pass');
      expect(roles?.received).toContain('Scim.Provision');
    });
  });
});


