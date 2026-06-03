/**
 * LoggingService.listLogs - in-memory filter parity (Phase D4 bonus fix).
 *
 * Pre-D4 the in-memory branch of listLogs() honored ONLY `endpointId`
 * and silently ignored every other filter dimension (method, status,
 * hasError, urlContains, since, until, search, includeAdmin,
 * minDurationMs). The Phase D4 fix replicates the Prisma where-clause
 * 1:1. This spec locks each filter dimension at the unit level so
 * future changes can't drop a filter by mistake.
 *
 * E2E coverage exists too (log-config.e2e-spec, endpoint-scoped-logs)
 * but unit-level lock is faster to fail and points more directly at
 * the misbehaving filter.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { LoggingService } from './logging.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScimLogger } from './scim-logger.service';

describe('LoggingService.listLogs - in-memory filter parity (Phase D4)', () => {
  let service: LoggingService;
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
    const logger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      trace: jest.fn(),
    };

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

  /** Seed via the public recordRequest API (same path the interceptor uses). */
  function seed(opts: {
    method?: string;
    url: string;
    status?: number;
    durationMs?: number;
    error?: Error;
    endpointId?: string;
    requestBody?: unknown;
    responseBody?: unknown;
    createdAt?: Date;
  }): void {
    service.recordRequest({
      method: opts.method ?? 'GET',
      url: opts.url,
      status: opts.status,
      durationMs: opts.durationMs,
      error: opts.error,
      endpointId: opts.endpointId,
      requestBody: opts.requestBody,
      responseBody: opts.responseBody,
    } as Parameters<typeof service.recordRequest>[0]);
    if (opts.createdAt) {
      const rows: Array<{ createdAt: Date }> = (service as unknown as { inMemoryLogRows: Array<{ createdAt: Date }> }).inMemoryLogRows;
      const last = rows[rows.length - 1];
      if (last) last.createdAt = opts.createdAt;
    }
  }

  it('honors method filter', async () => {
    seed({ method: 'GET', url: '/scim/endpoints/x/Users', status: 200 });
    seed({ method: 'POST', url: '/scim/endpoints/x/Users', status: 201 });
    seed({ method: 'POST', url: '/scim/endpoints/x/Groups', status: 201 });

    const res = await service.listLogs({ method: 'POST' });
    expect(res.total).toBe(2);
    expect(res.items.every((r) => r.method === 'POST')).toBe(true);
  });

  it('honors method filter case-insensitively (uppercases input)', async () => {
    seed({ method: 'POST', url: '/scim/endpoints/x/Users', status: 201 });
    const res = await service.listLogs({ method: 'post' });
    expect(res.total).toBe(1);
  });

  it('honors status filter', async () => {
    seed({ method: 'GET', url: '/scim/endpoints/x/Users', status: 200 });
    seed({ method: 'GET', url: '/scim/endpoints/x/Users', status: 404 });
    const res = await service.listLogs({ status: 404 });
    expect(res.total).toBe(1);
    expect(res.items[0].status).toBe(404);
  });

  it('honors hasError=true filter', async () => {
    seed({ method: 'GET', url: '/scim/endpoints/x/Users', status: 500, error: new Error('boom') });
    seed({ method: 'GET', url: '/scim/endpoints/x/Users', status: 200 });
    const res = await service.listLogs({ hasError: true });
    expect(res.total).toBe(1);
    expect(res.items[0].errorMessage).toBeDefined();
  });

  it('honors hasError=false filter', async () => {
    seed({ method: 'GET', url: '/scim/endpoints/x/Users', status: 500, error: new Error('boom') });
    seed({ method: 'GET', url: '/scim/endpoints/x/Users', status: 200 });
    const res = await service.listLogs({ hasError: false });
    expect(res.total).toBe(1);
    expect(res.items[0].errorMessage).toBeUndefined();
  });

  it('honors urlContains filter', async () => {
    seed({ method: 'GET', url: '/scim/endpoints/x/Users', status: 200 });
    seed({ method: 'GET', url: '/scim/endpoints/x/Groups', status: 200 });
    const res = await service.listLogs({ urlContains: 'Groups' });
    expect(res.total).toBe(1);
    expect(res.items[0].url).toContain('Groups');
  });

  it('honors since filter (lower bound on createdAt)', async () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const recent = new Date(Date.now() - 1 * 60 * 60 * 1000);
    seed({ method: 'GET', url: '/scim/endpoints/x/Users', status: 200, createdAt: old });
    seed({ method: 'GET', url: '/scim/endpoints/x/Users', status: 200, createdAt: recent });
    const res = await service.listLogs({ since: new Date(Date.now() - 12 * 60 * 60 * 1000) });
    expect(res.total).toBe(1);
  });

  it('honors until filter (upper bound on createdAt)', async () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const recent = new Date(Date.now() - 1 * 60 * 60 * 1000);
    seed({ method: 'GET', url: '/scim/endpoints/x/Users', status: 200, createdAt: old });
    seed({ method: 'GET', url: '/scim/endpoints/x/Users', status: 200, createdAt: recent });
    const res = await service.listLogs({ until: new Date(Date.now() - 12 * 60 * 60 * 1000) });
    expect(res.total).toBe(1);
  });

  it('honors minDurationMs filter', async () => {
    seed({ method: 'GET', url: '/scim/endpoints/x/Users', status: 200, durationMs: 5 });
    seed({ method: 'GET', url: '/scim/endpoints/x/Users', status: 200, durationMs: 5000 });
    const res = await service.listLogs({ minDurationMs: 1000 });
    expect(res.total).toBe(1);
    expect((res.items[0].durationMs ?? 0) >= 1000).toBe(true);
  });

  it('excludes admin / health / root by default (includeAdmin: false implicit)', async () => {
    seed({ method: 'GET', url: '/scim/admin/dashboard', status: 200 });
    seed({ method: 'GET', url: '/health', status: 200 });
    seed({ method: 'GET', url: '/', status: 200 });
    seed({ method: 'GET', url: '/scim/endpoints/x/Users', status: 200 });
    const res = await service.listLogs({});
    // Health probes that succeed are ALSO dropped at recordRequest layer
    // (see method-level docstring), so seeding /health with status=200
    // is a no-op. Admin + / still get filtered by listLogs.
    expect(res.total).toBe(1);
    expect(res.items[0].url).toContain('/Users');
  });

  it('includes admin / root when includeAdmin: true', async () => {
    seed({ method: 'GET', url: '/scim/admin/dashboard', status: 200 });
    seed({ method: 'GET', url: '/', status: 200 });
    seed({ method: 'GET', url: '/scim/endpoints/x/Users', status: 200 });
    const res = await service.listLogs({ includeAdmin: true });
    expect(res.total).toBe(3);
  });

  it('honors search filter across url and bodies', async () => {
    seed({
      method: 'POST',
      url: '/scim/endpoints/x/Users',
      status: 201,
      requestBody: { userName: 'needle@test.com' },
    });
    seed({ method: 'POST', url: '/scim/endpoints/x/Groups', status: 201 });
    const res = await service.listLogs({ search: 'needle@test.com' });
    expect(res.total).toBe(1);
  });

  it('honors endpointId filter (the one filter that always worked)', async () => {
    seed({ method: 'GET', url: '/scim/endpoints/A/Users', status: 200, endpointId: 'A' });
    seed({ method: 'GET', url: '/scim/endpoints/B/Users', status: 200, endpointId: 'B' });
    const res = await service.listLogs({ endpointId: 'A' });
    expect(res.total).toBe(1);
    expect(res.items[0].url).toContain('/A/');
  });

  it('combines multiple filters with AND semantics', async () => {
    seed({ method: 'POST', url: '/scim/endpoints/x/Users', status: 201, durationMs: 50 });
    seed({ method: 'GET', url: '/scim/endpoints/x/Users', status: 200, durationMs: 5000 });
    seed({ method: 'POST', url: '/scim/endpoints/x/Groups', status: 201, durationMs: 5000 });

    // method=POST AND minDurationMs=1000
    const res = await service.listLogs({ method: 'POST', minDurationMs: 1000 });
    expect(res.total).toBe(1);
    expect(res.items[0].url).toContain('/Groups');
  });
});
