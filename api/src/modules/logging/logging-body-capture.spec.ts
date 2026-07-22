/**
 * recordRequest body-capture safety: the free-text raw preview of an
 * unparseable body is redacted when secrets are not persisted, and any stored
 * body over the size cap is replaced with a truncation marker. Both backends
 * share this path; InMemory is exercised here (Prisma parity at E2E).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { LoggingService } from './logging.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScimLogger } from './scim-logger.service';
import { MAX_STORED_BODY_BYTES } from './request-body-capture';

describe('LoggingService.recordRequest - body-capture safety', () => {
  let service: LoggingService;
  const savedBackend = process.env.PERSISTENCE_BACKEND;
  const savedPrune = process.env.LOG_AUTO_PRUNE;
  const savedSecrets = process.env.PERSIST_REQUEST_SECRETS;

  async function build(): Promise<LoggingService> {
    const prisma = { requestLog: { findMany: jest.fn(), count: jest.fn(), deleteMany: jest.fn(), create: jest.fn(), createMany: jest.fn() } };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoggingService,
        { provide: PrismaService, useValue: prisma },
        { provide: ScimLogger, useValue: new ScimLogger() },
      ],
    }).compile();
    return module.get<LoggingService>(LoggingService);
  }

  beforeEach(() => {
    process.env.PERSISTENCE_BACKEND = 'inmemory';
    process.env.LOG_AUTO_PRUNE = 'false';
  });

  afterEach(async () => {
    await service?.onModuleDestroy?.();
    process.env.PERSISTENCE_BACKEND = savedBackend || '';
    process.env.LOG_AUTO_PRUNE = savedPrune || '';
    if (savedSecrets === undefined) delete process.env.PERSIST_REQUEST_SECRETS;
    else process.env.PERSIST_REQUEST_SECRETS = savedSecrets;
  });

  it('keeps the raw preview when secrets ARE persisted (default)', async () => {
    process.env.PERSIST_REQUEST_SECRETS = 'true';
    service = await build();
    service.recordRequest({
      method: 'POST',
      url: '/scim/endpoints/ep/Users',
      status: 400,
      requestBody: { _bodyNotCaptured: true, reason: 'unparseable', _rawPreview: 'client_secret=abc Bearer xyz' },
    } as Parameters<typeof service.recordRequest>[0]);
    const { items } = await service.listLogs({});
    const detail = await service.getLog(items[0].id);
    const body = detail?.requestBody as Record<string, unknown>;
    expect(body._rawPreview).toBe('client_secret=abc Bearer xyz');
  });

  it('redacts the raw preview when secrets are NOT persisted', async () => {
    process.env.PERSIST_REQUEST_SECRETS = 'false';
    service = await build();
    service.recordRequest({
      method: 'POST',
      url: '/scim/endpoints/ep/Users',
      status: 400,
      requestBody: { _bodyNotCaptured: true, reason: 'unparseable', _rawPreview: 'client_secret=abc Bearer xyz' },
    } as Parameters<typeof service.recordRequest>[0]);
    const { items } = await service.listLogs({});
    const detail = await service.getLog(items[0].id);
    const body = detail?.requestBody as Record<string, unknown>;
    expect(body._rawPreview).toBe('[REDACTED]');
    expect(JSON.stringify(body)).not.toContain('abc');
  });

  it('replaces an over-cap body with a truncation marker', async () => {
    process.env.PERSIST_REQUEST_SECRETS = 'true';
    service = await build();
    const huge = { blob: 'x'.repeat(MAX_STORED_BODY_BYTES + 5000) };
    service.recordRequest({
      method: 'POST',
      url: '/scim/endpoints/ep/Users',
      status: 200,
      requestBody: huge,
    } as Parameters<typeof service.recordRequest>[0]);
    const { items } = await service.listLogs({});
    const detail = await service.getLog(items[0].id);
    const body = detail?.requestBody as Record<string, unknown>;
    expect(body._truncated).toBe(true);
    expect(typeof body.originalLength).toBe('number');
  });
});
