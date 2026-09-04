/**
 * Unit tests for AdminWifDiagnosticsController (D1 step 1).
 *
 * These cases were moved verbatim from admin-credential.controller.spec.ts when
 * the three `wif/*` diagnostic routes were split out. They are unchanged on
 * purpose: a refactor's test suite has to keep asserting exactly what it did
 * before, or it cannot tell you the behaviour survived the move.
 *
 * The one addition is the shared-precondition block, which pins the 404-before-403
 * ordering now that the endpoint lookup and the WIF-enabled gate live in a single
 * helper rather than being copy-pasted into each route.
 */
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AdminWifDiagnosticsController } from './admin-wif-diagnostics.controller';
import { ScimLogger } from '../../logging/scim-logger.service';

describe('AdminWifDiagnosticsController', () => {
  let controller: AdminWifDiagnosticsController;
  let mockCredentialRepo: Record<string, jest.Mock>;
  let mockEndpointService: Record<string, jest.Mock>;
  let mockWifResolver: { resolve: jest.Mock; verifyTrust: jest.Mock };
  let mockWifValidator: { validate: jest.Mock; debug: jest.Mock };
  let loggerSpy: { info: jest.Mock; warn: jest.Mock; error: jest.Mock };

  const mockEndpoint = {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'test-endpoint',
    profile: { settings: { PerEndpointCredentialsEnabled: true } },
    active: true,
  };

  const mockCredential = {
    id: 'cred-1111',
    endpointId: mockEndpoint.id,
    credentialType: 'bearer',
    credentialHash: '$2b$12$hash',
    label: 'Test credential',
    metadata: null,
    active: true,
    createdAt: new Date(),
    expiresAt: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockCredentialRepo = {
      findById: jest.fn().mockResolvedValue(mockCredential),
      findActiveByEndpoint: jest.fn().mockResolvedValue([mockCredential]),
      updateMetadata: jest.fn().mockImplementation((id: string, metadata: Record<string, unknown>) =>
        Promise.resolve({ ...mockCredential, id, metadata }),
      ),
    };

    mockEndpointService = { getEndpoint: jest.fn().mockResolvedValue(mockEndpoint) };

    const mockScimLogger = {
      trace: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      fatal: jest.fn(),
      isEnabled: jest.fn().mockReturnValue(true),
      getConfig: jest.fn().mockReturnValue({}),
      runWithContext: jest.fn((ctx, fn) => fn()),
      getContext: jest.fn(),
      enrichContext: jest.fn(),
    } as unknown as ScimLogger;
    loggerSpy = mockScimLogger as unknown as typeof loggerSpy;

    controller = new AdminWifDiagnosticsController(
      mockCredentialRepo as any,
      mockEndpointService as any,
      mockScimLogger,
      (mockWifResolver = {
        resolve: jest.fn(),
        verifyTrust: jest.fn().mockResolvedValue({ ok: true, checks: [] }),
      }) as any,
      (mockWifValidator = { validate: jest.fn(), debug: jest.fn() }) as any,
    );
  });

  // The gate was duplicated in all three routes before the split. These assert
  // it still fires on EVERY route, so consolidating it into one helper cannot
  // silently drop it from one of them.
  describe('shared precondition (requireWifEnabled)', () => {
    const routes: Array<[string, () => Promise<unknown>]> = [
      ['resolveWifDiscovery', () => controller.resolveWifDiscovery(mockEndpoint.id, {} as never)],
      ['verifyWifTrust', () => controller.verifyWifTrust(mockEndpoint.id, {} as never)],
      ['debugWifAssertion', () => controller.debugWifAssertion(mockEndpoint.id, { assertion: 'a.b.c' })],
    ];

    it.each(routes)('%s rejects with 403 when WifCredentialsEnabled is off', async (_name, call) => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        ...mockEndpoint,
        profile: { settings: { WifCredentialsEnabled: false } },
      });
      await expect(call()).rejects.toBeInstanceOf(ForbiddenException);
    });

    // Order matters: an unknown endpoint must 404 and must NOT report on the
    // feature flags of an endpoint the caller cannot see.
    it.each(routes)('%s propagates the 404 for an unknown endpoint before any WIF gate', async (_name, call) => {
      mockEndpointService.getEndpoint.mockRejectedValue(new NotFoundException('no such endpoint'));
      await expect(call()).rejects.toBeInstanceOf(NotFoundException);
      expect(mockWifResolver.resolve).not.toHaveBeenCalled();
      expect(mockWifResolver.verifyTrust).not.toHaveBeenCalled();
      expect(mockWifValidator.debug).not.toHaveBeenCalled();
    });
  });

  describe('WI-D7 - debugWifAssertion (assertion debugger dry-run)', () => {
    const wifEndpoint = {
      ...mockEndpoint,
      profile: { settings: { WifCredentialsEnabled: true } },
    };
    const wifCred = {
      ...mockCredential,
      credentialType: 'wif',
      metadata: {
        expectedIssuer: 'https://idp/v2.0',
        expectedSubject: 'sub-abc',
        expectedAudience: 'api://app',
        jwksUri: 'https://login.microsoftonline.com/tid/discovery/v2.0/keys',
        allowedTenantId: 'tid',
      },
    };

    beforeEach(() => {
      mockEndpointService.getEndpoint.mockResolvedValue(wifEndpoint);
      mockCredentialRepo.findActiveByEndpoint.mockResolvedValue([wifCred]);
    });

    it('runs the validator dry-run per trust and returns overallOutcome accept when a trust accepts', async () => {
      mockWifValidator.debug.mockResolvedValue({
        outcome: 'accept',
        trace: { plane: 'token-mint', method: 'wif', outcome: 'accept', checks: [] },
      });

      const result = await controller.debugWifAssertion(mockEndpoint.id, { assertion: 'a.b.c' });

      expect(mockWifValidator.debug).toHaveBeenCalledWith(
        'a.b.c',
        expect.objectContaining({ expectedIssuer: 'https://idp/v2.0', jwksUri: wifCred.metadata.jwksUri }),
      );
      expect(result.overallOutcome).toBe('accept');
      expect(result.results).toHaveLength(1);
      expect(result.results[0].expectedIssuer).toBe('https://idp/v2.0');
    });

    it('returns overallOutcome reject with the per-trust reasonCode when the assertion fails', async () => {
      mockWifValidator.debug.mockResolvedValue({
        outcome: 'reject',
        reasonCode: 'wif_audience_mismatch',
        trace: { plane: 'token-mint', method: 'wif', outcome: 'reject', reasonCode: 'wif_audience_mismatch', checks: [] },
      });

      const result = await controller.debugWifAssertion(mockEndpoint.id, { assertion: 'a.b.c' });

      expect(result.overallOutcome).toBe('reject');
      expect(result.results[0].reasonCode).toBe('wif_audience_mismatch');
    });

    it('rejects an empty assertion body with a 400', async () => {
      await expect(
        controller.debugWifAssertion(mockEndpoint.id, { assertion: '   ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when WifCredentialsEnabled is off', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        ...mockEndpoint,
        profile: { settings: { WifCredentialsEnabled: false } },
      });
      await expect(
        controller.debugWifAssertion(mockEndpoint.id, { assertion: 'a.b.c' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('surfaces a misconfigured trust row as a reject result instead of throwing', async () => {
      mockCredentialRepo.findActiveByEndpoint.mockResolvedValue([
        { ...wifCred, metadata: { expectedIssuer: 'https://idp/v2.0' } }, // missing required fields
      ]);
      const result = await controller.debugWifAssertion(mockEndpoint.id, { assertion: 'a.b.c' });
      expect(result.overallOutcome).toBe('reject');
      expect(result.results[0].reasonCode).toBe('wif_no_trust_configured');
      expect(mockWifValidator.debug).not.toHaveBeenCalled();
    });

    // ── Phase 4 (auth-obs) - config-time audit event ──
    it('Phase 4: emits an "Auth config change" success event (dryRun) when the debug accepts', async () => {
      mockWifValidator.debug.mockResolvedValue({
        outcome: 'accept',
        trace: { plane: 'token-mint', method: 'wif', outcome: 'accept', checks: [] },
      });
      await controller.debugWifAssertion(mockEndpoint.id, { assertion: 'a.b.c' });
      const call = loggerSpy.info.mock.calls.find((c) => c[1] === 'Auth config change');
      expect(call).toBeDefined();
      expect(call![2]).toMatchObject({ action: 'wif_debug_assertion', outcome: 'success', dryRun: true, endpointId: mockEndpoint.id });
    });

    it('Phase 4: emits an "Auth config change" failure event (dryRun) with the reason code when the debug rejects', async () => {
      mockWifValidator.debug.mockResolvedValue({
        outcome: 'reject',
        reasonCode: 'wif_audience_mismatch',
        trace: { plane: 'token-mint', method: 'wif', outcome: 'reject', reasonCode: 'wif_audience_mismatch', checks: [] },
      });
      await controller.debugWifAssertion(mockEndpoint.id, { assertion: 'a.b.c' });
      const call = loggerSpy.warn.mock.calls.find((c) => c[1] === 'Auth config change');
      expect(call).toBeDefined();
      expect(call![2]).toMatchObject({ action: 'wif_debug_assertion', outcome: 'failure', dryRun: true, reasonCode: 'wif_audience_mismatch' });
    });
  });

  // ── Phase 4 (auth-obs) - verifyWifTrust config-time audit event ──
  describe('Phase 4 - verifyWifTrust audit event', () => {
    const wifEndpoint = { ...mockEndpoint, profile: { settings: { WifCredentialsEnabled: true } } };
    beforeEach(() => {
      mockEndpointService.getEndpoint.mockResolvedValue(wifEndpoint);
    });

    it('emits an "Auth config change" success event when the verify passes', async () => {
      mockWifResolver.verifyTrust.mockResolvedValue({ ok: true, checks: [] });
      await controller.verifyWifTrust(mockEndpoint.id, { expectedIssuer: 'https://idp/v2.0', jwksUri: 'https://idp/keys' } as never);
      const call = loggerSpy.info.mock.calls.find((c) => c[1] === 'Auth config change');
      expect(call).toBeDefined();
      expect(call![2]).toMatchObject({ action: 'wif_verify', outcome: 'success', method: 'wif', endpointId: mockEndpoint.id });
    });

    it('emits an "Auth config change" failure event when the verify fails', async () => {
      mockWifResolver.verifyTrust.mockResolvedValue({ ok: false, checks: [{ id: 'jwksReachable', label: 'x', ok: false }] });
      await controller.verifyWifTrust(mockEndpoint.id, { expectedIssuer: 'https://idp/v2.0', jwksUri: 'https://idp/keys' } as never);
      const call = loggerSpy.warn.mock.calls.find((c) => c[1] === 'Auth config change');
      expect(call).toBeDefined();
      expect(call![2]).toMatchObject({ action: 'wif_verify', outcome: 'failure' });
    });
  });

  describe('V7 - verify persists lastVerifiedAt on a saved trust', () => {
    const wifEndpoint = { ...mockEndpoint, profile: { settings: { WifCredentialsEnabled: true } } };
    beforeEach(() => {
      mockEndpointService.getEndpoint.mockResolvedValue(wifEndpoint);
    });

    it('stamps lastVerifiedAt on the credential when a passing verify supplies its credentialId', async () => {
      mockWifResolver.verifyTrust.mockResolvedValue({ ok: true, checks: [] });
      mockCredentialRepo.findById.mockResolvedValue({ ...mockCredential, id: 'wif-v7', credentialType: 'wif', credentialHash: '', metadata: { expectedIssuer: 'https://idp/v2.0' } });
      const res = await controller.verifyWifTrust(mockEndpoint.id, { expectedIssuer: 'https://idp/v2.0', jwksUri: 'https://idp/keys', credentialId: 'wif-v7' } as never);
      const meta = mockCredentialRepo.updateMetadata.mock.calls.at(-1)?.[1] as Record<string, unknown>;
      expect(typeof meta.lastVerifiedAt).toBe('string');
      expect(res.lastVerifiedAt).toBe(meta.lastVerifiedAt);
      // The prior metadata is preserved.
      expect(meta.expectedIssuer).toBe('https://idp/v2.0');
    });

    it('does NOT persist when no credentialId is supplied (pure dry-run)', async () => {
      mockWifResolver.verifyTrust.mockResolvedValue({ ok: true, checks: [] });
      const res = await controller.verifyWifTrust(mockEndpoint.id, { expectedIssuer: 'https://idp/v2.0', jwksUri: 'https://idp/keys' } as never);
      expect(mockCredentialRepo.updateMetadata).not.toHaveBeenCalled();
      expect(res.lastVerifiedAt).toBeUndefined();
    });

    it('does NOT persist when the verify fails even with a credentialId', async () => {
      mockWifResolver.verifyTrust.mockResolvedValue({ ok: false, checks: [{ id: 'jwksReachable', label: 'x', ok: false }] });
      mockCredentialRepo.findById.mockResolvedValue({ ...mockCredential, id: 'wif-v7', credentialType: 'wif', credentialHash: '' });
      const res = await controller.verifyWifTrust(mockEndpoint.id, { expectedIssuer: 'https://idp/v2.0', jwksUri: 'https://idp/keys', credentialId: 'wif-v7' } as never);
      expect(mockCredentialRepo.updateMetadata).not.toHaveBeenCalled();
      expect(res.lastVerifiedAt).toBeUndefined();
    });

    it('does NOT persist when the credentialId is not a wif credential of this endpoint', async () => {
      mockWifResolver.verifyTrust.mockResolvedValue({ ok: true, checks: [] });
      mockCredentialRepo.findById.mockResolvedValue({ ...mockCredential, id: 'br-1', credentialType: 'bearer' });
      const res = await controller.verifyWifTrust(mockEndpoint.id, { expectedIssuer: 'https://idp/v2.0', jwksUri: 'https://idp/keys', credentialId: 'br-1' } as never);
      expect(mockCredentialRepo.updateMetadata).not.toHaveBeenCalled();
      expect(res.lastVerifiedAt).toBeUndefined();
    });
  });

  describe('resolveWifDiscovery', () => {
    const wifEndpoint = { ...mockEndpoint, profile: { settings: { WifCredentialsEnabled: true } } };
    beforeEach(() => {
      mockEndpointService.getEndpoint.mockResolvedValue(wifEndpoint);
    });

    it('delegates to the resolver with the endpointId and returns its result unchanged', async () => {
      const resolved = { expectedIssuer: 'https://idp/v2.0', jwksUri: 'https://idp/keys', expectedAudience: mockEndpoint.id };
      mockWifResolver.resolve.mockResolvedValue(resolved);
      const res = await controller.resolveWifDiscovery(mockEndpoint.id, { tenantId: 'tid' } as never);
      expect(mockWifResolver.resolve).toHaveBeenCalledWith(mockEndpoint.id, { tenantId: 'tid' });
      expect(res).toBe(resolved);
    });

    it('passes an empty object when the body is absent (no throw on a bare POST)', async () => {
      mockWifResolver.resolve.mockResolvedValue({});
      await controller.resolveWifDiscovery(mockEndpoint.id, undefined as never);
      expect(mockWifResolver.resolve).toHaveBeenCalledWith(mockEndpoint.id, {});
    });
  });
});
