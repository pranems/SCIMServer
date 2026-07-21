/**
 * Unit tests for AdminCredentialController (Phase 11).
 *
 * Phase J (v0.48.1) additions:
 *   - The controller now emits SCIM_EVENTS.CREDENTIAL_CREATED /
 *     CREDENTIAL_REVOKED via EventEmitter2 on the success path so the
 *     ScimEventSseBridge can forward them onto the SSE wire for
 *     cross-tab CredentialsTab refresh. The controller test verifies
 *     emit-after-commit (call ordering relative to the persisted
 *     write).
 */
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AdminCredentialController } from './admin-credential.controller';
import { ScimLogger } from '../../logging/scim-logger.service';
import { SCIM_EVENTS } from '../../stats/scim-events';

// Mock bcrypt
jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('$2b$12$mockhash'),
}));

describe('AdminCredentialController', () => {
  let controller: AdminCredentialController;
  let mockCredentialRepo: Record<string, jest.Mock>;
  let mockEndpointService: Record<string, jest.Mock>;
  let mockEventEmitter: { emit: jest.Mock };
  let mockWifResolver: { resolve: jest.Mock; verifyTrust: jest.Mock };
  let mockWifValidator: { validate: jest.Mock; debug: jest.Mock };
  let loggerSpy: { info: jest.Mock; warn: jest.Mock; error: jest.Mock };
  const mockEndpoint = {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'test-endpoint',
    profile: { settings: { PerEndpointCredentialsEnabled: true } },
    active: true,
    scimBasePath: '/scim/endpoints/11111111-1111-1111-1111-111111111111',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    _links: {
      self: '/admin/endpoints/11111111-1111-1111-1111-111111111111',
      stats: '/admin/endpoints/11111111-1111-1111-1111-111111111111/stats',
      credentials: '/admin/endpoints/11111111-1111-1111-1111-111111111111/credentials',
      scim: '/scim/endpoints/11111111-1111-1111-1111-111111111111',
    },
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
      create: jest.fn().mockResolvedValue(mockCredential),
      findByEndpoint: jest.fn().mockResolvedValue([mockCredential]),
      findById: jest.fn().mockResolvedValue(mockCredential),
      findActiveByEndpoint: jest.fn().mockResolvedValue([mockCredential]),
      deactivate: jest.fn().mockResolvedValue({ ...mockCredential, active: false }),
      delete: jest.fn().mockResolvedValue(undefined),
      updateMetadata: jest.fn().mockImplementation((id: string, metadata: Record<string, unknown>) =>
        Promise.resolve({ ...mockCredential, id, metadata }),
      ),
      updateLabel: jest.fn().mockImplementation((id: string, label: string | null) =>
        Promise.resolve({ ...mockCredential, id, label }),
      ),
    };

    mockEndpointService = {
      getEndpoint: jest.fn().mockResolvedValue(mockEndpoint),
    };

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
    controller = new AdminCredentialController(
      mockCredentialRepo as any,
      mockEndpointService as any,
      mockScimLogger,
      (mockEventEmitter = { emit: jest.fn() }) as unknown as EventEmitter2,
      (mockWifResolver = { resolve: jest.fn(), verifyTrust: jest.fn().mockResolvedValue({ ok: true, checks: [] }) }) as any,
      // WI-6/WI-7: credential encryption + security services. Defaults make
      // retention a no-op (isReady=false) so existing tests are unaffected.
      { isReady: jest.fn().mockReturnValue(false), encrypt: jest.fn(), decrypt: jest.fn() } as any,
      { getEffectiveVisibility: jest.fn().mockResolvedValue('always'), getServerVisibility: jest.fn().mockResolvedValue('always'), purgeRetainedSecrets: jest.fn() } as any,
      (mockWifValidator = { validate: jest.fn(), debug: jest.fn() }) as any,
    );
  });

  describe('createCredential', () => {
    it('should create a credential and return plaintext token', async () => {
      const result = await controller.createCredential(mockEndpoint.id, {
        label: 'My token',
      });

      expect(result.id).toBeDefined();
      expect(result.token).toBeDefined();
      expect(result.token!.length).toBeGreaterThan(10);
      expect(result.endpointId).toBe(mockEndpoint.id);
      expect(mockCredentialRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          endpointId: mockEndpoint.id,
          credentialType: 'bearer',
          label: 'My token',
        }),
      );
    });

    it('should reject when PerEndpointCredentialsEnabled is false', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        ...mockEndpoint,
        profile: { settings: { PerEndpointCredentialsEnabled: false } },
      });

      await expect(
        controller.createCredential(mockEndpoint.id, {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject when config is empty', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        ...mockEndpoint,
        profile: { settings: {} },
      });

      await expect(
        controller.createCredential(mockEndpoint.id, {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject invalid credentialType', async () => {
      await expect(
        controller.createCredential(mockEndpoint.id, { credentialType: 'invalid' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject invalid expiresAt format', async () => {
      await expect(
        controller.createCredential(mockEndpoint.id, { expiresAt: 'not-a-date' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject expiresAt in the past', async () => {
      await expect(
        controller.createCredential(mockEndpoint.id, {
          expiresAt: '2020-01-01T00:00:00Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should accept valid expiresAt in the future', async () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString(); // +1 day
      const result = await controller.createCredential(mockEndpoint.id, {
        expiresAt: futureDate,
      });

      expect(result.token).toBeDefined();
      expect(mockCredentialRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          expiresAt: expect.any(Date),
        }),
      );
    });

    it('should accept oauth_client credential type', async () => {
      const result = await controller.createCredential(mockEndpoint.id, {
        credentialType: 'oauth_client',
      });

      // Q1: oauth_client returns a client_id + client_secret pair, NOT a bearer token.
      expect(result.token).toBeUndefined();
      expect(result.clientId).toBeDefined();
      expect(typeof result.clientId).toBe('string');
      expect(result.clientSecret).toBeDefined();
      expect(typeof result.clientSecret).toBe('string');
      expect(result.clientSecret!.length).toBeGreaterThan(10);
      expect(mockCredentialRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          credentialType: 'oauth_client',
          metadata: expect.objectContaining({ clientId: result.clientId }),
        }),
      );
    });

    it('Q1: oauth_client stores only the bcrypt hash of the secret, never the plaintext', async () => {
      const result = await controller.createCredential(mockEndpoint.id, {
        credentialType: 'oauth_client',
      });
      const createArg = mockCredentialRepo.create.mock.calls[0][0];
      // The stored hash must not equal the returned plaintext secret.
      expect(createArg.credentialHash).toBeDefined();
      expect(createArg.credentialHash).not.toBe(result.clientSecret);
      // The plaintext secret must not be persisted anywhere in the create input.
      expect(JSON.stringify(createArg)).not.toContain(result.clientSecret);
    });

    it('R7: the first oauth_client uses the client-id-<endpointId> + client-secret-<uuid> format', async () => {
      mockCredentialRepo.findByEndpoint.mockResolvedValue([]);
      const result = await controller.createCredential(mockEndpoint.id, {
        credentialType: 'oauth_client',
      });
      // Readable, operator-requested formats.
      expect(result.clientId).toBe(`client-id-${mockEndpoint.id}`);
      expect(result.clientSecret).toMatch(
        /^client-secret-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('R7: an additional oauth_client gets a generated client-id-<uuid> (no collision)', async () => {
      mockCredentialRepo.findByEndpoint.mockResolvedValue([
        { credentialType: 'oauth_client', metadata: { clientId: `client-id-${mockEndpoint.id}` } },
      ] as never);
      const result = await controller.createCredential(mockEndpoint.id, {
        credentialType: 'oauth_client',
      });
      expect(result.clientId).toMatch(
        /^client-id-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(result.clientId).not.toBe(`client-id-${mockEndpoint.id}`);
    });

    it('should throw NotFoundException for non-existent endpoint', async () => {
      mockEndpointService.getEndpoint.mockRejectedValue(
        new NotFoundException('Endpoint not found'),
      );

      await expect(
        controller.createCredential('bad-id', {}),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('orthogonal create gate (A1)', () => {
    it('allows a wif credential when only WifCredentialsEnabled is on', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        ...mockEndpoint,
        profile: { settings: { WifCredentialsEnabled: true, PerEndpointCredentialsEnabled: false } },
      });
      mockCredentialRepo.create.mockResolvedValue({ ...mockCredential, credentialType: 'wif', credentialHash: '' });

      const result = await controller.createCredential(mockEndpoint.id, {
        credentialType: 'wif',
        wif: {
          assertionProfile: 'jwt-bearer',
          expectedIssuer: 'https://login.microsoftonline.com/tid/v2.0',
          expectedAudience: 'appid',
          expectedSubject: 'sub',
          jwksUri: 'https://login.microsoftonline.com/tid/discovery/v2.0/keys',
          allowedTenantId: 'tid',
        },
      } as never);

      expect(result.credentialType).toBe('wif');
      expect(mockCredentialRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ credentialType: 'wif' }),
      );
    });

    it('rejects a wif credential when WifCredentialsEnabled is off', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        ...mockEndpoint,
        profile: { settings: { WifCredentialsEnabled: false, PerEndpointCredentialsEnabled: true } },
      });

      await expect(
        controller.createCredential(mockEndpoint.id, { credentialType: 'wif' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('still requires PerEndpointCredentialsEnabled for a bearer credential', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        ...mockEndpoint,
        profile: { settings: { WifCredentialsEnabled: true, PerEndpointCredentialsEnabled: false } },
      });

      await expect(
        controller.createCredential(mockEndpoint.id, { credentialType: 'bearer' }),
      ).rejects.toThrow(ForbiddenException);
    });

    // ── WI-11 - per-method create gate ──────────────────────────────────────
    it('WI-11: allows a bearer credential when SecretTokenBearerAuthEnabled is on (no legacy flag)', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        ...mockEndpoint,
        profile: { settings: { SecretTokenBearerAuthEnabled: true } },
      });
      mockCredentialRepo.create.mockResolvedValue({ ...mockCredential, credentialType: 'bearer' });
      const result = await controller.createCredential(mockEndpoint.id, { credentialType: 'bearer' });
      expect(result.credentialType).toBe('bearer');
    });

    it('WI-11: allows an oauth_client credential when OAuthClientCredentialsAuthEnabled is on (no legacy flag)', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        ...mockEndpoint,
        profile: { settings: { OAuthClientCredentialsAuthEnabled: true } },
      });
      mockCredentialRepo.create.mockResolvedValue({ ...mockCredential, credentialType: 'oauth_client', metadata: { clientId: 'epc_x' } });
      const result = await controller.createCredential(mockEndpoint.id, { credentialType: 'oauth_client' });
      expect(result.credentialType).toBe('oauth_client');
    });

    it('WI-11: value-preserving - legacy PerEndpointCredentialsEnabled=true still allows bearer + oauth_client', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        ...mockEndpoint,
        profile: { settings: { PerEndpointCredentialsEnabled: true } },
      });
      mockCredentialRepo.create.mockResolvedValue({ ...mockCredential, credentialType: 'bearer' });
      await expect(controller.createCredential(mockEndpoint.id, { credentialType: 'bearer' })).resolves.toBeDefined();
      mockCredentialRepo.create.mockResolvedValue({ ...mockCredential, credentialType: 'oauth_client', metadata: { clientId: 'epc_y' } });
      await expect(controller.createCredential(mockEndpoint.id, { credentialType: 'oauth_client' })).resolves.toBeDefined();
    });

    it('WI-11: an explicit OAuthClientCredentialsAuthEnabled=false blocks oauth_client even if bearer is on', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        ...mockEndpoint,
        profile: { settings: { SecretTokenBearerAuthEnabled: true, OAuthClientCredentialsAuthEnabled: false } },
      });
      await expect(
        controller.createCredential(mockEndpoint.id, { credentialType: 'oauth_client' }),
      ).rejects.toThrow(ForbiddenException);
    });

    // ── WI-14 - oauth_client smart default client_id ───────────────────────
    it('WI-14: the FIRST oauth_client on an endpoint defaults its client_id to the endpointId', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        ...mockEndpoint,
        profile: { settings: { OAuthClientCredentialsAuthEnabled: true } },
      });
      mockCredentialRepo.findByEndpoint.mockResolvedValue([]); // no existing oauth_client
      mockCredentialRepo.create.mockResolvedValue({ ...mockCredential, credentialType: 'oauth_client', metadata: { clientId: `client-id-${mockEndpoint.id}` } });
      const result = await controller.createCredential(mockEndpoint.id, { credentialType: 'oauth_client' });
      expect(result.clientId).toBe(`client-id-${mockEndpoint.id}`);
      // The create call carried the client-id-<endpointId> form as the client_id.
      const created = mockCredentialRepo.create.mock.calls.at(-1)?.[0] as { metadata: { clientId: string } };
      expect(created.metadata.clientId).toBe(`client-id-${mockEndpoint.id}`);
    });

    it('WI-14: a SECOND oauth_client gets a generated client_id (no collision)', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        ...mockEndpoint,
        profile: { settings: { OAuthClientCredentialsAuthEnabled: true } },
      });
      mockCredentialRepo.findByEndpoint.mockResolvedValue([{ ...mockCredential, credentialType: 'oauth_client', metadata: { clientId: `client-id-${mockEndpoint.id}` } }]);
      mockCredentialRepo.create.mockImplementation((data: { metadata?: { clientId?: string } }) =>
        Promise.resolve({ ...mockCredential, credentialType: 'oauth_client', metadata: data.metadata }),
      );
      const result = await controller.createCredential(mockEndpoint.id, { credentialType: 'oauth_client' });
      expect(result.clientId).toMatch(/^client-id-[0-9a-f]{8}-/);
      expect(result.clientId).not.toBe(`client-id-${mockEndpoint.id}`);
    });

    it('WI-14: an explicit clientId always wins over the default', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        ...mockEndpoint,
        profile: { settings: { OAuthClientCredentialsAuthEnabled: true } },
      });
      mockCredentialRepo.findByEndpoint.mockResolvedValue([]);
      mockCredentialRepo.create.mockImplementation((data: { metadata?: { clientId?: string } }) =>
        Promise.resolve({ ...mockCredential, credentialType: 'oauth_client', metadata: data.metadata }),
      );
      const result = await controller.createCredential(mockEndpoint.id, { credentialType: 'oauth_client', clientId: 'my-custom-id' } as never);
      expect(result.clientId).toBe('my-custom-id');
    });

    it('the wif response carries NO secret/hash field', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        ...mockEndpoint,
        profile: { settings: { WifCredentialsEnabled: true } },
      });
      mockCredentialRepo.create.mockResolvedValue({ ...mockCredential, credentialType: 'wif', credentialHash: '' });

      const result = await controller.createCredential(mockEndpoint.id, {
        credentialType: 'wif',
        wif: {
          assertionProfile: 'jwt-bearer',
          expectedIssuer: 'https://idp/v2.0',
          expectedAudience: 'appid',
          expectedSubject: 'sub',
          jwksUri: 'https://login.microsoftonline.com/tid/discovery/v2.0/keys',
          allowedTenantId: 'tid',
        },
      } as never);

      const serialized = JSON.stringify(result);
      expect(serialized).not.toMatch(/token|clientSecret|credentialHash|secret/i);
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

  describe('WI-13 - WIF trust claim-name input aliases + expectedTenantId', () => {
    beforeEach(() => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        ...mockEndpoint,
        profile: { settings: { WifCredentialsEnabled: true } },
      });
      mockCredentialRepo.create.mockResolvedValue({ ...mockCredential, credentialType: 'wif', credentialHash: '' });
    });

    it('accepts bare claim names (iss/sub/aud/tid/roles) as aliases and stores canonical keys', async () => {
      await controller.createCredential(mockEndpoint.id, {
        credentialType: 'wif',
        wif: {
          iss: 'https://login.microsoftonline.com/tid/v2.0',
          sub: 'sp-obj-id',
          aud: 'api://appid',
          jwksUri: 'https://login.microsoftonline.com/tid/discovery/v2.0/keys',
          tid: 'tenant-guid',
          roles: ['Scim.Provision'],
        },
      } as never);

      const created = mockCredentialRepo.create.mock.calls.at(-1)?.[0] as { metadata: Record<string, unknown> };
      expect(created.metadata).toMatchObject({
        expectedIssuer: 'https://login.microsoftonline.com/tid/v2.0',
        expectedSubject: 'sp-obj-id',
        expectedAudience: 'api://appid',
        allowedTenantId: 'tenant-guid',
        requiredRoles: ['Scim.Provision'],
      });
      // Alias keys must NOT be persisted (only canonical keys are stored).
      expect(created.metadata).not.toHaveProperty('iss');
      expect(created.metadata).not.toHaveProperty('tid');
      expect(created.metadata).not.toHaveProperty('roles');
    });

    it('accepts expectedTenantId as the preferred name for the tenant (alias of allowedTenantId)', async () => {
      await controller.createCredential(mockEndpoint.id, {
        credentialType: 'wif',
        wif: {
          expectedIssuer: 'https://idp/v2.0',
          expectedSubject: 'sub',
          expectedAudience: 'appid',
          jwksUri: 'https://login.microsoftonline.com/tid/discovery/v2.0/keys',
          expectedTenantId: 'tenant-new-name',
        },
      } as never);

      const created = mockCredentialRepo.create.mock.calls.at(-1)?.[0] as { metadata: Record<string, unknown> };
      expect(created.metadata.allowedTenantId).toBe('tenant-new-name');
    });

    it('prefers an explicit canonical key over its alias when both are supplied', async () => {
      await controller.createCredential(mockEndpoint.id, {
        credentialType: 'wif',
        wif: {
          expectedIssuer: 'https://canonical/v2.0',
          iss: 'https://alias/v2.0',
          expectedSubject: 'sub',
          expectedAudience: 'appid',
          jwksUri: 'https://login.microsoftonline.com/tid/discovery/v2.0/keys',
          allowedTenantId: 'tid',
        },
      } as never);

      const created = mockCredentialRepo.create.mock.calls.at(-1)?.[0] as { metadata: Record<string, unknown> };
      expect(created.metadata.expectedIssuer).toBe('https://canonical/v2.0');
    });
  });

  describe('U8 - glean allowedTenantId from issuer / JWKS URI when omitted', () => {
    const TENANT = '72f988bf-86f1-41af-91ab-2d7cd011db47';

    beforeEach(() => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        ...mockEndpoint,
        profile: { settings: { WifCredentialsEnabled: true } },
      });
      mockCredentialRepo.create.mockResolvedValue({ ...mockCredential, credentialType: 'wif', credentialHash: '' });
    });

    it('gleans allowedTenantId from the issuer and records the source when omitted', async () => {
      await controller.createCredential(mockEndpoint.id, {
        credentialType: 'wif',
        wif: {
          expectedIssuer: `https://login.microsoftonline.com/${TENANT}/v2.0`,
          expectedSubject: 'sp-obj-id',
          expectedAudience: 'api://appid',
          jwksUri: `https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`,
        },
      } as never);

      const created = mockCredentialRepo.create.mock.calls.at(-1)?.[0] as { metadata: Record<string, unknown> };
      expect(created.metadata.allowedTenantId).toBe(TENANT);
      expect(created.metadata.allowedTenantIdSource).toBe('issuer');
    });

    it('falls back to the JWKS URI when the issuer carries no tenant GUID', async () => {
      await controller.createCredential(mockEndpoint.id, {
        credentialType: 'wif',
        wif: {
          expectedIssuer: 'https://accounts.google.com',
          expectedSubject: 'sub',
          expectedAudience: 'appid',
          jwksUri: `https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`,
        },
      } as never);

      const created = mockCredentialRepo.create.mock.calls.at(-1)?.[0] as { metadata: Record<string, unknown> };
      expect(created.metadata.allowedTenantId).toBe(TENANT);
      expect(created.metadata.allowedTenantIdSource).toBe('jwksUri');
    });

    it('does NOT override an explicitly supplied allowedTenantId and records no source', async () => {
      await controller.createCredential(mockEndpoint.id, {
        credentialType: 'wif',
        wif: {
          expectedIssuer: `https://login.microsoftonline.com/${TENANT}/v2.0`,
          expectedSubject: 'sub',
          expectedAudience: 'appid',
          jwksUri: `https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`,
          allowedTenantId: 'explicit-tenant',
        },
      } as never);

      const created = mockCredentialRepo.create.mock.calls.at(-1)?.[0] as { metadata: Record<string, unknown> };
      expect(created.metadata.allowedTenantId).toBe('explicit-tenant');
      expect(created.metadata).not.toHaveProperty('allowedTenantIdSource');
    });

    it('rejects when the tenant is neither supplied nor inferable', async () => {
      await expect(
        controller.createCredential(mockEndpoint.id, {
          credentialType: 'wif',
          wif: {
            expectedIssuer: 'https://accounts.google.com',
            expectedSubject: 'sub',
            expectedAudience: 'appid',
            jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
          },
        } as never),
      ).rejects.toThrow(/allowedTenantId/);
    });
  });

  describe('U7 - lastVerifiedAt stamped on verify-on-save', () => {
    const TENANT = '72f988bf-86f1-41af-91ab-2d7cd011db47';

    beforeEach(() => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        ...mockEndpoint,
        profile: { settings: { WifCredentialsEnabled: true } },
      });
      mockCredentialRepo.create.mockResolvedValue({ ...mockCredential, credentialType: 'wif', credentialHash: '' });
      mockWifResolver.verifyTrust.mockResolvedValue({ ok: true, checks: [] });
    });

    it('stamps lastVerifiedAt when a create passes verify-on-save', async () => {
      await controller.createCredential(mockEndpoint.id, {
        credentialType: 'wif',
        verify: true,
        wif: {
          expectedIssuer: `https://login.microsoftonline.com/${TENANT}/v2.0`,
          expectedSubject: 'sub',
          expectedAudience: 'appid',
          jwksUri: `https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`,
        },
      } as never);
      const created = mockCredentialRepo.create.mock.calls.at(-1)?.[0] as { metadata: Record<string, unknown> };
      expect(typeof created.metadata.lastVerifiedAt).toBe('string');
      expect(Number.isNaN(Date.parse(created.metadata.lastVerifiedAt as string))).toBe(false);
    });

    it('does NOT stamp lastVerifiedAt when a create did not request verify', async () => {
      await controller.createCredential(mockEndpoint.id, {
        credentialType: 'wif',
        wif: {
          expectedIssuer: `https://login.microsoftonline.com/${TENANT}/v2.0`,
          expectedSubject: 'sub',
          expectedAudience: 'appid',
          jwksUri: `https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`,
        },
      } as never);
      const created = mockCredentialRepo.create.mock.calls.at(-1)?.[0] as { metadata: Record<string, unknown> };
      expect(created.metadata).not.toHaveProperty('lastVerifiedAt');
    });
  });

  describe('listCredentials', () => {
    it('should list credentials without hashes', async () => {
      const result = await controller.listCredentials(mockEndpoint.id);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(mockCredential.id);
      expect(result[0]).not.toHaveProperty('credentialHash');
      expect(result[0]).not.toHaveProperty('token');
    });

    it('should return empty array when no credentials exist', async () => {
      mockCredentialRepo.findByEndpoint.mockResolvedValue([]);
      const result = await controller.listCredentials(mockEndpoint.id);
      expect(result).toEqual([]);
    });
  });

  describe('revokeCredential', () => {
    it('should deactivate a credential', async () => {
      await controller.revokeCredential(mockEndpoint.id, mockCredential.id);
      expect(mockCredentialRepo.deactivate).toHaveBeenCalledWith(mockCredential.id);
    });

    it('should throw NotFoundException when credential does not exist', async () => {
      mockCredentialRepo.findById.mockResolvedValue(null);

      await expect(
        controller.revokeCredential(mockEndpoint.id, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when credential belongs to different endpoint', async () => {
      mockCredentialRepo.findById.mockResolvedValue({
        ...mockCredential,
        endpointId: 'different-endpoint-id',
      });

      await expect(
        controller.revokeCredential(mockEndpoint.id, mockCredential.id),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateWifCredential (item 4 - edit a saved trust)', () => {
    const wifCred = {
      ...mockCredential,
      id: 'wif-edit-1',
      credentialType: 'wif',
      credentialHash: '',
      metadata: {
        expectedIssuer: 'https://old.example/v2.0',
        expectedSubject: 'old-sub',
        expectedAudience: 'old-aud',
        jwksUri: 'https://old.example/keys',
        allowedTenantId: 'old-tid',
        assertionProfile: 'jwt-bearer',
      },
    };

    it('replaces the public trust metadata and echoes the updated trust', async () => {
      mockCredentialRepo.findById.mockResolvedValue(wifCred);
      const result = await controller.updateWifCredential(mockEndpoint.id, 'wif-edit-1', {
        credentialType: 'wif',
        wif: {
          expectedIssuer: 'https://new.example/v2.0',
          expectedSubject: 'new-sub',
          expectedAudience: 'new-aud',
          jwksUri: 'https://new.example/keys',
          allowedTenantId: 'new-tid',
          requiredRoles: ['Scim.Provision'],
        },
      } as never);

      expect(mockCredentialRepo.updateMetadata).toHaveBeenCalledWith(
        'wif-edit-1',
        expect.objectContaining({
          expectedIssuer: 'https://new.example/v2.0',
          expectedSubject: 'new-sub',
          allowedTenantId: 'new-tid',
          requiredRoles: ['Scim.Provision'],
        }),
      );
      expect(result.wif).toMatchObject({ expectedIssuer: 'https://new.example/v2.0' });
      // No secret ever appears on a wif response.
      expect((result as unknown as Record<string, unknown>).token).toBeUndefined();
    });

    it('accepts claim-name aliases (iss/sub/aud/tid) on edit', async () => {
      mockCredentialRepo.findById.mockResolvedValue(wifCred);
      await controller.updateWifCredential(mockEndpoint.id, 'wif-edit-1', {
        credentialType: 'wif',
        wif: {
          iss: 'https://alias.example/v2.0',
          sub: 'alias-sub',
          aud: 'alias-aud',
          jwksUri: 'https://alias.example/keys',
          tid: 'alias-tid',
        },
      } as never);
      const meta = mockCredentialRepo.updateMetadata.mock.calls.at(-1)?.[1] as Record<string, unknown>;
      expect(meta.expectedIssuer).toBe('https://alias.example/v2.0');
      expect(meta.allowedTenantId).toBe('alias-tid');
      expect(meta.iss).toBeUndefined();
    });

    it('rejects an edit that drops a required field', async () => {
      mockCredentialRepo.findById.mockResolvedValue(wifCred);
      await expect(
        controller.updateWifCredential(mockEndpoint.id, 'wif-edit-1', {
          credentialType: 'wif',
          wif: { expectedIssuer: 'https://x/v2.0' },
        } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects editing a non-wif credential (rotate a secret instead)', async () => {
      mockCredentialRepo.findById.mockResolvedValue({ ...mockCredential, credentialType: 'bearer' });
      await expect(
        controller.updateWifCredential(mockEndpoint.id, mockCredential.id, {
          credentialType: 'wif',
          wif: {
            expectedIssuer: 'https://x/v2.0',
            expectedSubject: 's',
            expectedAudience: 'a',
            jwksUri: 'https://x/keys',
            allowedTenantId: 't',
          },
        } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('404s when the credential does not exist / belongs to another endpoint', async () => {
      mockCredentialRepo.findById.mockResolvedValue(null);
      await expect(
        controller.updateWifCredential(mockEndpoint.id, 'ghost', {
          credentialType: 'wif',
          wif: {
            expectedIssuer: 'https://x/v2.0',
            expectedSubject: 's',
            expectedAudience: 'a',
            jwksUri: 'https://x/keys',
            allowedTenantId: 't',
          },
        } as never),
      ).rejects.toThrow(NotFoundException);
    });

    it('item 4: edits the label when supplied alongside the trust', async () => {
      mockCredentialRepo.findById.mockResolvedValue(wifCred);
      await controller.updateWifCredential(mockEndpoint.id, 'wif-edit-1', {
        credentialType: 'wif',
        label: 'Renamed trust',
        wif: {
          expectedIssuer: 'https://new.example/v2.0',
          expectedSubject: 's',
          expectedAudience: 'a',
          jwksUri: 'https://new.example/keys',
          allowedTenantId: 't',
        },
      } as never);
      expect(mockCredentialRepo.updateLabel).toHaveBeenCalledWith('wif-edit-1', 'Renamed trust');
    });
  });

  describe('item C - verify-on-save reachability gate', () => {
    const wifTrust = {
      expectedIssuer: 'https://idp.example/v2.0',
      expectedSubject: 'sub',
      expectedAudience: 'aud',
      jwksUri: 'https://idp.example/keys',
      allowedTenantId: 'tid',
    };

    beforeEach(() => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        ...mockEndpoint,
        profile: { settings: { WifCredentialsEnabled: true } },
      });
      mockCredentialRepo.create.mockResolvedValue({ ...mockCredential, credentialType: 'wif', credentialHash: '' });
    });

    it('does NOT verify when verify is absent/false (backward compat, pre-staging allowed)', async () => {
      await controller.createCredential(mockEndpoint.id, { credentialType: 'wif', wif: wifTrust } as never);
      expect(mockWifResolver.verifyTrust).not.toHaveBeenCalled();
      expect(mockCredentialRepo.create).toHaveBeenCalled();
    });

    it('verifies + persists when verify:true and the checks pass', async () => {
      mockWifResolver.verifyTrust.mockResolvedValue({ ok: true, checks: [{ id: 'jwksServesKeys', label: 'JWKS serves keys', ok: true, detail: '5 keys' }] });
      await controller.createCredential(mockEndpoint.id, { credentialType: 'wif', verify: true, wif: wifTrust } as never);
      expect(mockWifResolver.verifyTrust).toHaveBeenCalledWith(
        expect.objectContaining({ expectedIssuer: wifTrust.expectedIssuer, jwksUri: wifTrust.jwksUri }),
      );
      expect(mockCredentialRepo.create).toHaveBeenCalled();
    });

    it('rejects with 422 + the failed checks and does NOT persist when verify:true fails', async () => {
      mockWifResolver.verifyTrust.mockResolvedValue({
        ok: false,
        checks: [
          { id: 'jwksReachable', label: 'JWKS URI reachable', ok: false, detail: 'HTTP 404.' },
          { id: 'jwksServesKeys', label: 'JWKS serves keys', ok: false, detail: 'no keys' },
        ],
      });
      await expect(
        controller.createCredential(mockEndpoint.id, { credentialType: 'wif', verify: true, wif: wifTrust } as never),
      ).rejects.toMatchObject({
        status: 422,
        response: expect.objectContaining({ scimType: 'invalidValue', checks: expect.any(Array) }),
      });
      expect(mockCredentialRepo.create).not.toHaveBeenCalled();
    });

    it('the same gate applies to an edit (PUT) with verify:true', async () => {
      mockCredentialRepo.findById.mockResolvedValue({ ...mockCredential, id: 'wif-x', credentialType: 'wif', credentialHash: '', metadata: wifTrust });
      mockWifResolver.verifyTrust.mockResolvedValue({ ok: false, checks: [{ id: 'jwksReachable', label: 'JWKS URI reachable', ok: false, detail: 'HTTP 500.' }] });
      await expect(
        controller.updateWifCredential(mockEndpoint.id, 'wif-x', { credentialType: 'wif', verify: true, wif: wifTrust } as never),
      ).rejects.toMatchObject({ status: 422 });
      expect(mockCredentialRepo.updateMetadata).not.toHaveBeenCalled();
    });
  });

  // ─── Phase J (v0.48.1) - SSE event emission ────────────────────────
  describe('Phase J - SCIM event emission for SSE bridge', () => {
    it('emits SCIM_EVENTS.CREDENTIAL_CREATED after a successful create', async () => {
      await controller.createCredential(mockEndpoint.id, { label: 'Phase J' });

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        SCIM_EVENTS.CREDENTIAL_CREATED,
        expect.objectContaining({
          endpointId: mockEndpoint.id,
          credentialId: mockCredential.id,
          credentialType: mockCredential.credentialType,
        }),
      );
    });

    it('emits CREDENTIAL_CREATED AFTER the persisted write (event payload uses repo-returned id)', async () => {
      await controller.createCredential(mockEndpoint.id, {});

      // Order check: the create call must come first; if the emit
      // happened before the repo resolved, the payload would not have
      // the persisted id.
      const createCallOrder = mockCredentialRepo.create.mock.invocationCallOrder[0];
      const emitCallOrder = mockEventEmitter.emit.mock.invocationCallOrder[0];
      expect(createCallOrder).toBeLessThan(emitCallOrder);
    });

    it('does NOT emit CREDENTIAL_CREATED when the endpoint config rejects the operation', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        ...mockEndpoint,
        profile: { settings: { PerEndpointCredentialsEnabled: false } },
      });

      await expect(
        controller.createCredential(mockEndpoint.id, {}),
      ).rejects.toThrow(ForbiddenException);

      expect(mockEventEmitter.emit).not.toHaveBeenCalledWith(
        SCIM_EVENTS.CREDENTIAL_CREATED,
        expect.anything(),
      );
    });

    it('emits SCIM_EVENTS.CREDENTIAL_REVOKED after a successful revoke', async () => {
      await controller.revokeCredential(mockEndpoint.id, mockCredential.id);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        SCIM_EVENTS.CREDENTIAL_REVOKED,
        expect.objectContaining({
          endpointId: mockEndpoint.id,
          credentialId: mockCredential.id,
        }),
      );
    });

    it('does NOT emit CREDENTIAL_REVOKED when the credential is not found', async () => {
      mockCredentialRepo.findById.mockResolvedValue(null);

      await expect(
        controller.revokeCredential(mockEndpoint.id, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);

      expect(mockEventEmitter.emit).not.toHaveBeenCalledWith(
        SCIM_EVENTS.CREDENTIAL_REVOKED,
        expect.anything(),
      );
    });

    it('NEVER includes the credential hash or plaintext token in the emitted payload (PII boundary)', async () => {
      await controller.createCredential(mockEndpoint.id, { label: 'PII test' });

      const [, payload] = mockEventEmitter.emit.mock.calls.find(
        (c) => c[0] === SCIM_EVENTS.CREDENTIAL_CREATED,
      ) as [string, Record<string, unknown>];
      expect(payload).not.toHaveProperty('credentialHash');
      expect(payload).not.toHaveProperty('token');
      expect(payload).not.toHaveProperty('hash');
    });
  });

  describe('rotateCredential (WI-9)', () => {
    it('mints a new oauth_client secret, preserves the client_id, and deactivates the old', async () => {
      mockCredentialRepo.findById.mockResolvedValue({
        ...mockCredential,
        id: 'old-cred',
        credentialType: 'oauth_client',
        metadata: { clientId: 'epc_keep' },
      });
      mockCredentialRepo.create.mockResolvedValue({
        ...mockCredential,
        id: 'new-cred',
        credentialType: 'oauth_client',
        metadata: { clientId: 'epc_keep' },
      });

      const res = await controller.rotateCredential(mockEndpoint.id, 'old-cred');

      expect(res.id).toBe('new-cred');
      expect(res.rotatedFrom).toBe('old-cred');
      expect(res.clientId).toBe('epc_keep');
      expect(res.clientSecret).toBeDefined();
      // The new credential keeps the client_id.
      const createArg = mockCredentialRepo.create.mock.calls.at(-1)?.[0] as { metadata?: { clientId?: string } };
      expect(createArg.metadata?.clientId).toBe('epc_keep');
      // The old credential is deactivated.
      expect(mockCredentialRepo.deactivate).toHaveBeenCalledWith('old-cred');
    });

    it('returns the token field for a bearer credential', async () => {
      mockCredentialRepo.findById.mockResolvedValue({ ...mockCredential, id: 'old-b', credentialType: 'bearer' });
      mockCredentialRepo.create.mockResolvedValue({ ...mockCredential, id: 'new-b', credentialType: 'bearer' });
      const res = await controller.rotateCredential(mockEndpoint.id, 'old-b');
      expect(res.token).toBeDefined();
      expect(res.clientSecret).toBeUndefined();
    });

    it('rejects rotating a wif credential', async () => {
      mockCredentialRepo.findById.mockResolvedValue({ ...mockCredential, id: 'w', credentialType: 'wif', credentialHash: '' });
      await expect(controller.rotateCredential(mockEndpoint.id, 'w')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFound when the credential does not belong to the endpoint', async () => {
      mockCredentialRepo.findById.mockResolvedValue({ ...mockCredential, endpointId: 'other-ep' });
      await expect(controller.rotateCredential(mockEndpoint.id, 'x')).rejects.toThrow(NotFoundException);
    });

    it('emits a create + a revoke event and never leaks the hash', async () => {
      mockCredentialRepo.findById.mockResolvedValue({ ...mockCredential, id: 'old-e', credentialType: 'oauth_client', metadata: { clientId: 'epc_e' } });
      mockCredentialRepo.create.mockResolvedValue({ ...mockCredential, id: 'new-e', credentialType: 'oauth_client', metadata: { clientId: 'epc_e' } });
      await controller.rotateCredential(mockEndpoint.id, 'old-e');
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(SCIM_EVENTS.CREDENTIAL_CREATED, expect.objectContaining({ credentialId: 'new-e' }));
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(SCIM_EVENTS.CREDENTIAL_REVOKED, expect.objectContaining({ credentialId: 'old-e' }));
      for (const [, payload] of mockEventEmitter.emit.mock.calls as [string, Record<string, unknown>][]) {
        expect(payload).not.toHaveProperty('credentialHash');
      }
    });
  });
});
