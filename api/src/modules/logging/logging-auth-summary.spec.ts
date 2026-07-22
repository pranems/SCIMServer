/**
 * V10 - auth summary persisted on the RequestLog row.
 *
 * The auth decision for a request (outcome / method / reason / winning
 * credential) is stamped onto the correlation context by
 * `emitAuthDecisionEvent` earlier in the same async chain, then persisted
 * onto the RequestLog by `recordRequest`. This spec locks that the four
 * `auth*` fields survive record -> list -> detail on the InMemory backend so
 * the logs list can render the auth outcome instantly (no second per-row
 * Auth-Decision-Record lookup). Prisma parity is covered at the E2E layer.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { LoggingService } from './logging.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScimLogger, CorrelationContext } from './scim-logger.service';

describe('LoggingService - auth summary on RequestLog (V10)', () => {
  let service: LoggingService;
  let logger: ScimLogger;
  const savedBackend = process.env.PERSISTENCE_BACKEND;
  const savedPrune = process.env.LOG_AUTO_PRUNE;

  beforeEach(async () => {
    process.env.PERSISTENCE_BACKEND = 'inmemory';
    process.env.LOG_AUTO_PRUNE = 'false';

    const prisma = {
      requestLog: {
        findMany: jest.fn(),
        count: jest.fn(),
        deleteMany: jest.fn(),
        create: jest.fn(),
        createMany: jest.fn(),
      },
    };
    logger = new ScimLogger();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoggingService,
        { provide: PrismaService, useValue: prisma },
        { provide: ScimLogger, useValue: logger },
      ],
    }).compile();
    service = module.get<LoggingService>(LoggingService);
  });

  afterEach(async () => {
    await service.onModuleDestroy?.();
    process.env.PERSISTENCE_BACKEND = savedBackend || '';
    process.env.LOG_AUTO_PRUNE = savedPrune || '';
  });

  /** Seed a request while a correlation context (with an auth summary) is active. */
  function seedWithAuth(ctx: Partial<CorrelationContext>, url = '/scim/endpoints/ep-x/Users'): void {
    logger.runWithContext({ requestId: 'req-auth-1', ...ctx } as CorrelationContext, () => {
      service.recordRequest({
        method: 'POST',
        url,
        status: 201,
        durationMs: 5,
      } as Parameters<typeof service.recordRequest>[0]);
    });
  }

  it('persists an ACCEPT auth summary and returns it from listLogs', async () => {
    seedWithAuth({
      authOutcome: 'accept',
      authMethod: 'wif',
      authReason: 'ok',
      authCredentialId: 'cred-wif-1',
    });

    const res = await service.listLogs({});
    expect(res.total).toBe(1);
    const row = res.items[0];
    expect(row.authOutcome).toBe('accept');
    expect(row.authMethod).toBe('wif');
    expect(row.authReason).toBe('ok');
    expect(row.authCredentialId).toBe('cred-wif-1');
  });

  it('persists a REJECT auth summary and returns it from listLogs', async () => {
    logger.runWithContext(
      {
        requestId: 'req-auth-2',
        authOutcome: 'reject',
        authMethod: 'wif',
        authReason: 'issuer_mismatch',
      } as CorrelationContext,
      () => {
        service.recordRequest({
          method: 'POST',
          url: '/scim/endpoints/ep-x/Users',
          status: 401,
        } as Parameters<typeof service.recordRequest>[0]);
      },
    );

    const res = await service.listLogs({});
    const row = res.items[0];
    expect(row.authOutcome).toBe('reject');
    expect(row.authReason).toBe('issuer_mismatch');
    expect(row.authCredentialId).toBeUndefined();
  });

  it('returns the auth summary from the log detail (getLog)', async () => {
    seedWithAuth({
      authOutcome: 'accept',
      authMethod: 'oauth_client',
      authReason: 'ok',
      authCredentialId: 'cred-oauth-9',
    });

    const list = await service.listLogs({});
    const id = list.items[0].id;
    const detail = await service.getLog(id);
    expect(detail?.authOutcome).toBe('accept');
    expect(detail?.authMethod).toBe('oauth_client');
    expect(detail?.authCredentialId).toBe('cred-oauth-9');
  });

  it('leaves the auth fields undefined when no auth decision was stamped', async () => {
    service.recordRequest({
      method: 'GET',
      url: '/scim/endpoints/ep-x/Users',
      status: 200,
    } as Parameters<typeof service.recordRequest>[0]);

    const res = await service.listLogs({});
    const row = res.items[0];
    expect(row.authOutcome).toBeUndefined();
    expect(row.authMethod).toBeUndefined();
    expect(row.authReason).toBeUndefined();
    expect(row.authCredentialId).toBeUndefined();
  });
});
