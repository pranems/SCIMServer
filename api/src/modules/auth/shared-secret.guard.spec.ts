import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { SharedSecretGuard } from './shared-secret.guard';
import { AuthDecisionRecordStore } from '../../oauth/auth-decision-record.store';

describe('SharedSecretGuard', () => {
  let guard: SharedSecretGuard;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockOAuthService: any;
  let mockReflector: jest.Mocked<Reflector>;
  let mockLogger: any;
  let mockCredentialRepo: any;
  let mockEndpointService: any;

  function createMockContext(authHeader?: string, isPublic = false) {
    const mockResponse = {
      setHeader: jest.fn(),
    };
    const mockRequest: any = {
      headers: authHeader ? { authorization: authHeader } : {},
      url: '/some/path',
    };
    const mockContext: any = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    };

    // Set up reflector to return isPublic value
    mockReflector.getAllAndOverride.mockReturnValue(isPublic);

    return { context: mockContext, request: mockRequest, response: mockResponse };
  }

  /** Helper: create a mock context with an endpoint-scoped URL */
  function createEndpointMockContext(endpointId: string, authHeader?: string) {
    const mockResponse = { setHeader: jest.fn() };
    const mockRequest: any = {
      headers: authHeader ? { authorization: authHeader } : {},
      url: `/endpoints/${endpointId}/Users`,
    };
    const mockContext: any = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    };
    mockReflector.getAllAndOverride.mockReturnValue(false);
    return { context: mockContext, request: mockRequest, response: mockResponse };
  }

  beforeEach(() => {
    jest.clearAllMocks();

    mockConfigService = {
      get: jest.fn().mockReturnValue('test-shared-secret'),
    } as any;

    mockOAuthService = {
      validateAccessToken: jest.fn(),
    };

    mockReflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    } as any;

    mockLogger = {
      trace: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      fatal: jest.fn(),
      enrichContext: jest.fn(),
    };

    mockCredentialRepo = {
      findActiveByEndpoint: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      findById: jest.fn(),
      findByEndpoint: jest.fn(),
      deactivate: jest.fn(),
      delete: jest.fn(),
    };

    mockEndpointService = {
      getEndpoint: jest.fn().mockResolvedValue({
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        name: 'test',
        profile: { settings: {} },
        active: true,
      }),
    };

    guard = new SharedSecretGuard(
      mockConfigService,
      mockOAuthService,
      mockReflector,
      mockLogger,
      mockCredentialRepo,
      mockEndpointService,
    );
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  // F3 + F4 - resource-plane bearer sub-reason + reason_code on the wire.
  describe('F3/F4 - bearer reason codes', () => {
    const DIAG = 'urn:scimserver:api:messages:2.0:Diagnostics';
    const endpointId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    let record: jest.Mock;
    let g: SharedSecretGuard;

    beforeEach(() => {
      record = jest.fn();
      g = new SharedSecretGuard(
        mockConfigService,
        mockOAuthService,
        mockReflector,
        mockLogger,
        mockCredentialRepo,
        mockEndpointService,
        { record } as unknown as AuthDecisionRecordStore,
      );
    });

    async function expectReject(context: any): Promise<any> {
      try {
        await g.canActivate(context);
        throw new Error('expected reject');
      } catch (err) {
        return (err as UnauthorizedException).getResponse();
      }
    }

    it('F3: an EXPIRED OAuth JWT surfaces bearer_oauth_expired (not bearer_invalid)', async () => {
      mockOAuthService.validateAccessToken.mockRejectedValue(Object.assign(new Error('jwt expired'), { code: 'ERR_JWT_EXPIRED' }));
      const { context } = createEndpointMockContext(endpointId, 'Bearer not-the-shared-secret.jwt.value');
      const body = await expectReject(context);
      expect(body[DIAG]?.reason_code).toBe('bearer_oauth_expired');
      expect(record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'reject', reasonCode: 'bearer_oauth_expired' }));
    });

    it('F3: a bad-signature OAuth JWT surfaces bearer_oauth_signature_invalid', async () => {
      mockOAuthService.validateAccessToken.mockRejectedValue(Object.assign(new Error('bad sig'), { code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' }));
      const { context } = createEndpointMockContext(endpointId, 'Bearer not-the-shared-secret.jwt.value');
      const body = await expectReject(context);
      expect(body[DIAG]?.reason_code).toBe('bearer_oauth_signature_invalid');
    });

    it('F3: a non-JWT junk token still collapses to bearer_invalid', async () => {
      mockOAuthService.validateAccessToken.mockRejectedValue(new Error('Invalid Compact JWS'));
      const { context } = createEndpointMockContext(endpointId, 'Bearer randomjunk');
      const body = await expectReject(context);
      expect(body[DIAG]?.reason_code).toBe('bearer_invalid');
    });

    it('F4: a missing bearer carries reason_code bearer_missing in diagnostics', async () => {
      const { context } = createEndpointMockContext(endpointId, undefined);
      const body = await expectReject(context);
      expect(body[DIAG]?.reason_code).toBe('bearer_missing');
      expect(body.scimType).toBe('invalidToken');
    });

    it('F4: a token scoped to another endpoint carries bearer_token_scoped_other_endpoint', async () => {
      mockOAuthService.validateAccessToken.mockResolvedValue({ endpoint_id: 'other-endpoint', client_id: 'c' });
      const { context } = createEndpointMockContext(endpointId, 'Bearer scoped.elsewhere');
      const body = await expectReject(context);
      expect(body[DIAG]?.reason_code).toBe('bearer_token_scoped_other_endpoint');
    });
  });

  describe('WI-11 - SharedSecretBearerAuthEnabled gate on the global secret', () => {
    const endpointId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

    it('an endpoint with SharedSecretBearerAuthEnabled=false REFUSES the global secret', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        id: endpointId,
        name: 'test',
        profile: { settings: { SharedSecretBearerAuthEnabled: false } },
        active: true,
      });
      const { context } = createEndpointMockContext(endpointId, 'Bearer test-shared-secret');
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('an endpoint with SharedSecretBearerAuthEnabled=true (default) still accepts the global secret', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        id: endpointId,
        name: 'test',
        profile: { settings: { SharedSecretBearerAuthEnabled: true } },
        active: true,
      });
      const { context, request } = createEndpointMockContext(endpointId, 'Bearer test-shared-secret');
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      expect(request.authType).toBe('legacy');
    });

    it('an unset endpoint (no auth flags) still accepts the global secret (back-compat)', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        id: endpointId,
        name: 'test',
        profile: { settings: {} },
        active: true,
      });
      const { context, request } = createEndpointMockContext(endpointId, 'Bearer test-shared-secret');
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      expect(request.authType).toBe('legacy');
    });

    it('a GLOBAL (non-endpoint) route always accepts the shared secret regardless of any flag', async () => {
      const { context, request } = createMockContext('Bearer test-shared-secret');
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      expect(request.authType).toBe('legacy');
    });
  });

  describe('public routes', () => {
    it('should allow access to public routes without auth', async () => {
      const { context } = createMockContext(undefined, true);
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should allow access to public routes even with auth header', async () => {
      const { context } = createMockContext('Bearer some-token', true);
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });
  });

  describe('missing auth header', () => {
    it('should reject request without authorization header', async () => {
      const { context } = createMockContext(undefined);
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should reject request with non-Bearer auth', async () => {
      const { context } = createMockContext('Basic dXNlcjpwYXNz');
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('legacy bearer token', () => {
    it('should authenticate with valid shared secret', async () => {
      const { context, request } = createMockContext('Bearer test-shared-secret');
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      expect(request.authType).toBe('legacy');
    });

    it('should not call OAuth validation for matching shared secret', async () => {
      const { context } = createMockContext('Bearer test-shared-secret');
      await guard.canActivate(context);
      expect(mockOAuthService.validateAccessToken).not.toHaveBeenCalled();
    });
  });

  describe('OAuth token validation', () => {
    it('should authenticate with valid OAuth token', async () => {
      const mockPayload = { sub: 'client', client_id: 'client-1', scope: 'scim.read' };
      mockOAuthService.validateAccessToken.mockResolvedValue(mockPayload);

      const { context, request } = createMockContext('Bearer oauth-jwt-token');
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      expect(request.authType).toBe('oauth');
      expect(request.oauth).toEqual(mockPayload);
    });

    it('should try OAuth first when token does not match shared secret', async () => {
      const mockPayload = { sub: 'c', client_id: 'c', scope: 's' };
      mockOAuthService.validateAccessToken.mockResolvedValue(mockPayload);

      const { context } = createMockContext('Bearer some-jwt');
      await guard.canActivate(context);
      expect(mockOAuthService.validateAccessToken).toHaveBeenCalledWith('some-jwt');
    });

    it('should reject when both OAuth and legacy fail', async () => {
      mockOAuthService.validateAccessToken.mockRejectedValue(new Error('invalid'));

      const { context } = createMockContext('Bearer wrong-token');
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('per-endpoint OAuth token scoping (Q1)', () => {
    const EP_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const EP_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

    it('authorizes a per-endpoint token on its own endpoint route', async () => {
      mockOAuthService.validateAccessToken.mockResolvedValue({
        sub: 'epc_x', client_id: 'epc_x', scope: 'scim.read', endpoint_id: EP_A,
      });
      const { context, request } = createEndpointMockContext(EP_A, 'Bearer ep-token');
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      expect(request.authType).toBe('oauth');
    });

    it('rejects a per-endpoint token presented to a DIFFERENT endpoint', async () => {
      mockOAuthService.validateAccessToken.mockResolvedValue({
        sub: 'epc_x', client_id: 'epc_x', scope: 'scim.read', endpoint_id: EP_A,
      });
      const { context, response } = createEndpointMockContext(EP_B, 'Bearer ep-token');
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      // mine-but-invalid-stop: enriched WWW-Authenticate, never fell through to legacy.
      expect(response.setHeader).toHaveBeenCalledWith(
        'WWW-Authenticate',
        expect.stringContaining('error="invalid_token"'),
      );
    });

    it('rejects a per-endpoint token on a non-endpoint (global) route', async () => {
      mockOAuthService.validateAccessToken.mockResolvedValue({
        sub: 'epc_x', client_id: 'epc_x', scope: 'scim.read', endpoint_id: EP_A,
      });
      // createMockContext uses url '/some/path' - no /endpoints/<id>/ segment.
      const { context } = createMockContext('Bearer ep-token');
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('a per-endpoint token does NOT fall through to the legacy secret on mismatch', async () => {
      // Even if the token string happened to also be probed as legacy, the
      // endpoint mismatch must stop first. Here the token is a JWT, not the
      // shared secret, so legacy would fail anyway; assert the rejection path.
      mockOAuthService.validateAccessToken.mockResolvedValue({
        sub: 'epc_x', client_id: 'epc_x', endpoint_id: EP_A,
      });
      const { context, request } = createEndpointMockContext(EP_B, 'Bearer ep-token');
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(request.authType).toBeUndefined();
    });

    it('a GLOBAL token (no endpoint_id) still authorizes any endpoint route', async () => {
      mockOAuthService.validateAccessToken.mockResolvedValue({
        sub: 'global', client_id: 'global', scope: 'scim.read',
      });
      const { context, request } = createEndpointMockContext(EP_A, 'Bearer global-token');
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      expect(request.authType).toBe('oauth');
    });
  });

  describe('auto-generated secret in dev mode', () => {
    it('should auto-generate secret when SCIM_SHARED_SECRET not configured', async () => {
      const origSecret = process.env.SCIM_SHARED_SECRET;
      delete process.env.SCIM_SHARED_SECRET;

      mockConfigService.get.mockReturnValue(undefined);
      guard = new SharedSecretGuard(mockConfigService, mockOAuthService, mockReflector, mockLogger, mockCredentialRepo, mockEndpointService);

      // First call triggers auto-generation and rejects (we don't know the secret yet)
      // but the secret is now in process.env.SCIM_SHARED_SECRET
      const { context: ctx1 } = createMockContext('Bearer dummy');
      mockOAuthService.validateAccessToken.mockRejectedValue(new Error('invalid'));
      try { await guard.canActivate(ctx1); } catch { /* expected rejection */ }

      // Secret should have been generated and stored in process.env
      const generatedSecret = process.env.SCIM_SHARED_SECRET as unknown as string;
      expect(generatedSecret).toBeDefined();
      expect(generatedSecret.length).toBeGreaterThan(10);

      // Update mock so ConfigService returns the generated secret on subsequent calls
      mockConfigService.get.mockReturnValue(generatedSecret);

      // Second call with the generated secret should succeed
      const { context: ctx2, request: req2 } = createMockContext(`Bearer ${generatedSecret}`);
      const result = await guard.canActivate(ctx2);
      expect(result).toBe(true);
      expect(req2.authType).toBe('legacy');

      // Restore
      if (origSecret) {
        process.env.SCIM_SHARED_SECRET = origSecret;
      } else {
        delete process.env.SCIM_SHARED_SECRET;
      }
    });
  });

  describe('per-endpoint credentials', () => {
    const endpointId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

    it('should skip per-endpoint check when flag is disabled', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        id: endpointId,
        name: 'test',
        profile: { settings: { PerEndpointCredentialsEnabled: false } },
        active: true,
      });

      // Use endpoint-scoped URL but with legacy token
      const { context, request } = createEndpointMockContext(endpointId, 'Bearer test-shared-secret');
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      expect(request.authType).toBe('legacy');
    });

    it('should authenticate with valid per-endpoint credential', async () => {
      // bcrypt: mock module at top of test
      const bcrypt = await import('bcrypt');
      const hash = await bcrypt.hash('my-endpoint-token', 10);

      mockEndpointService.getEndpoint.mockResolvedValue({
        id: endpointId,
        name: 'test',
        profile: { settings: { PerEndpointCredentialsEnabled: true } },
        active: true,
      });
      mockCredentialRepo.findActiveByEndpoint.mockResolvedValue([
        {
          id: 'cred-1',
          endpointId,
          credentialType: 'bearer',
          credentialHash: hash,
          label: 'Test',
          active: true,
          createdAt: new Date(),
          expiresAt: null,
        },
      ]);

      const { context, request } = createEndpointMockContext(endpointId, 'Bearer my-endpoint-token');
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      expect(request.authType).toBe('endpoint_credential');
      expect(request.authCredentialId).toBe('cred-1');
    });

    it('should fall back to legacy when per-endpoint credential does not match', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        id: endpointId,
        name: 'test',
        profile: { settings: { PerEndpointCredentialsEnabled: true } },
        active: true,
      });
      mockCredentialRepo.findActiveByEndpoint.mockResolvedValue([
        {
          id: 'cred-1',
          endpointId,
          credentialType: 'bearer',
          credentialHash: '$2b$10$invalidhashxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
          label: 'Test',
          active: true,
          createdAt: new Date(),
          expiresAt: null,
        },
      ]);

      const { context, request } = createEndpointMockContext(endpointId, 'Bearer test-shared-secret');
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      expect(request.authType).toBe('legacy'); // Fell back to global secret
    });

    it('should fall back to legacy when no active credentials exist', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        id: endpointId,
        name: 'test',
        profile: { settings: { PerEndpointCredentialsEnabled: true } },
        active: true,
      });
      mockCredentialRepo.findActiveByEndpoint.mockResolvedValue([]);

      const { context, request } = createEndpointMockContext(endpointId, 'Bearer test-shared-secret');
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      expect(request.authType).toBe('legacy');
    });

    it('should fall back to OAuth when per-endpoint check fails and token is not legacy', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        id: endpointId,
        name: 'test',
        profile: { settings: { PerEndpointCredentialsEnabled: true } },
        active: true,
      });
      mockCredentialRepo.findActiveByEndpoint.mockResolvedValue([]);

      const oauthPayload = { sub: 'client', client_id: 'c', scope: 's' };
      mockOAuthService.validateAccessToken.mockResolvedValue(oauthPayload);

      const { context, request } = createEndpointMockContext(endpointId, 'Bearer some-jwt');
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      expect(request.authType).toBe('oauth');
    });

    it('should not check per-endpoint credentials for non-endpoint URLs', async () => {
      // URL without /endpoints/:uuid/ pattern, using legacy secret
      const { context, request } = createMockContext('Bearer test-shared-secret');
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      expect(request.authType).toBe('legacy');
      expect(mockEndpointService.getEndpoint).not.toHaveBeenCalled();
    });

    it('should handle endpoint service errors gracefully and fall back', async () => {
      mockEndpointService.getEndpoint.mockRejectedValue(new Error('DB error'));

      const { context, request } = createEndpointMockContext(endpointId, 'Bearer test-shared-secret');
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      expect(request.authType).toBe('legacy'); // Graceful fallback
    });

    it('should work without credential repo (optional injection)', async () => {
      const guardNoRepo = new SharedSecretGuard(
        mockConfigService,
        mockOAuthService,
        mockReflector,
        mockLogger,
        null,  // no credential repo
        null,  // no endpoint service
      );

      const { context, request } = createEndpointMockContext(endpointId, 'Bearer test-shared-secret');
      const result = await guardNoRepo.canActivate(context);
      expect(result).toBe(true);
      expect(request.authType).toBe('legacy');
    });
  });

  // Phase 2 (auth observability) - the resource plane records ONE
  // AuthDecisionTrace per endpoint-scoped auth attempt capturing the whole
  // method-selection cascade (which candidates were enabled, what was
  // presented, which method won, and why the others were skipped).
  describe('Phase 2 - resource-plane auth-decision tracing', () => {
    const endpointId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    let store: AuthDecisionRecordStore;

    beforeEach(() => {
      store = new AuthDecisionRecordStore();
      guard = new SharedSecretGuard(
        mockConfigService,
        mockOAuthService,
        mockReflector,
        mockLogger,
        mockCredentialRepo,
        mockEndpointService,
        store,
      );
    });

    it('records an accept trace (plane=resource, method=endpoint_bearer) when a per-endpoint bearer credential matches', async () => {
      const bcrypt = require('bcrypt');
      const token = 'per-endpoint-token-123';
      const hash = await bcrypt.hash(token, 4);
      mockEndpointService.getEndpoint.mockResolvedValue({
        id: endpointId,
        name: 'test',
        profile: { settings: { SecretTokenBearerAuthEnabled: 'True' } },
        active: true,
      });
      mockCredentialRepo.findActiveByEndpoint.mockResolvedValue([
        { id: 'cred-1', credentialType: 'bearer', credentialHash: hash, label: 'x' },
      ]);

      const { context } = createEndpointMockContext(endpointId, `Bearer ${token}`);
      const result = await guard.canActivate(context);
      expect(result).toBe(true);

      const recs = store.query({ endpointId });
      expect(recs.length).toBeGreaterThan(0);
      expect(recs[0].plane).toBe('resource');
      expect(recs[0].outcome).toBe('accept');
      expect(recs[0].method).toBe('endpoint_bearer');
      const eb = recs[0].checks.find((c) => c.id === 'endpoint_bearer');
      expect(eb?.status).toBe('pass');
      // No raw token is ever stored.
      expect(JSON.stringify(recs[0])).not.toContain(token);
    });

    it('records an accept trace (method=shared_secret) when the global secret matches', async () => {
      const { context } = createEndpointMockContext(endpointId, 'Bearer test-shared-secret');
      await guard.canActivate(context);
      const recs = store.query({ endpointId, outcome: 'accept' });
      expect(recs[0].method).toBe('shared_secret');
      const ss = recs[0].checks.find((c) => c.id === 'shared_secret');
      expect(ss?.status).toBe('pass');
    });

    it('records a reject trace with the full method-selection cascade when every method fails', async () => {
      mockOAuthService.validateAccessToken.mockRejectedValue(new Error('invalid'));
      const { context } = createEndpointMockContext(endpointId, 'Bearer completely-wrong');
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
      const recs = store.query({ endpointId, outcome: 'reject' });
      expect(recs.length).toBeGreaterThan(0);
      const ids = recs[0].checks.map((c) => c.id);
      expect(ids).toEqual(expect.arrayContaining(['token_presented', 'endpoint_bearer', 'oauth_jwt', 'shared_secret']));
      // The cascade explains WHY each candidate did not win (received/detail set).
      for (const c of recs[0].checks) {
        expect(c.received).toBeDefined();
      }
      expect(JSON.stringify(recs[0])).not.toContain('completely-wrong');
    });

    it('records a reject trace with reason bearer_token_scoped_other_endpoint when an OAuth token is presented to the wrong endpoint', async () => {
      mockOAuthService.validateAccessToken.mockResolvedValue({
        client_id: 'c1',
        endpoint_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      });
      const { context } = createEndpointMockContext(endpointId, 'Bearer some-oauth-jwt');
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
      const recs = store.query({ endpointId, outcome: 'reject' });
      expect(recs[0].reasonCode).toBe('bearer_token_scoped_other_endpoint');
      const jwt = recs[0].checks.find((c) => c.id === 'oauth_jwt');
      expect(jwt?.status).toBe('fail');
    });
  });
});
