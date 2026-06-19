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
    expect(verify).toHaveBeenCalledWith('assertion.jwt.value', TRUST.jwksUri);
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

  it('rejects when a required role is missing', async () => {
    verify.mockResolvedValue({ payload: { ...goodPayload(), roles: ['Scim.Read'] }, protectedHeader: {} });
    await expect(service.validate('a', TRUST)).rejects.toBeInstanceOf(WifAssertionInvalidError);
  });

  it('rejects when the roles claim is absent but roles are required', async () => {
    const p = goodPayload();
    delete (p as Record<string, unknown>).roles;
    verify.mockResolvedValue({ payload: p, protectedHeader: {} });
    await expect(service.validate('a', TRUST)).rejects.toBeInstanceOf(WifAssertionInvalidError);
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
});
