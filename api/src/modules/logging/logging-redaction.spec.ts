/**
 * LoggingService - RequestLog secret-persistence privacy (F1).
 *
 * By DEFAULT the RequestLog stores the COMPLETE request/response (headers + body,
 * secrets included) for fast RCA. The effective `PersistRequestSecrets` flag
 * (server env `PERSIST_REQUEST_SECRETS`, per-endpoint config override) turns that
 * off, in which case secret-bearing header/body values are redacted BEFORE the
 * row is persisted (and therefore before API/UI display). Endpoint overrides
 * server. This spec locks all three resolutions at the unit level.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { LoggingService } from './logging.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScimLogger } from './scim-logger.service';
import { EndpointService } from '../endpoint/services/endpoint.service';

interface StoredRow {
  requestHeaders: string | null;
  requestBody: string | null;
  responseBody: string | null;
  endpointId: string | null;
}

describe('LoggingService - RequestLog secret persistence (F1)', () => {
  const savedBackend = process.env.PERSISTENCE_BACKEND;
  const savedPrune = process.env.LOG_AUTO_PRUNE;
  const savedPersist = process.env.PERSIST_REQUEST_SECRETS;

  let cachedSettings: Record<string, unknown> | undefined;

  async function makeService(): Promise<LoggingService> {
    const prisma = {
      requestLog: { findMany: jest.fn(), count: jest.fn(), deleteMany: jest.fn(), create: jest.fn(), createMany: jest.fn() },
    };
    const logger = { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn(), trace: jest.fn() };
    const endpointService = {
      getCachedProfileSettings: jest.fn(() => cachedSettings),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoggingService,
        { provide: PrismaService, useValue: prisma },
        { provide: ScimLogger, useValue: logger },
        { provide: EndpointService, useValue: endpointService },
      ],
    }).compile();
    return module.get<LoggingService>(LoggingService);
  }

  function rowsOf(service: LoggingService): StoredRow[] {
    return (service as unknown as { inMemoryLogRows: StoredRow[] }).inMemoryLogRows;
  }

  function record(service: LoggingService, endpointId?: string): void {
    service.recordRequest({
      method: 'POST',
      url: endpointId ? `/scim/endpoints/${endpointId}/oauth/token` : '/scim/oauth/token',
      status: 200,
      requestHeaders: { authorization: 'Basic dXNlcjpzZWNyZXQ=', 'content-type': 'application/json' },
      requestBody: { grant_type: 'client_credentials', client_id: 'epc_x', client_secret: 'super-secret' },
      responseBody: { access_token: 'jwt.value.here', token_type: 'Bearer', expires_in: 3600 },
      endpointId,
    });
  }

  beforeEach(() => {
    process.env.PERSISTENCE_BACKEND = 'inmemory';
    process.env.LOG_AUTO_PRUNE = 'false';
    delete process.env.PERSIST_REQUEST_SECRETS;
    cachedSettings = undefined;
  });

  afterEach(() => {
    process.env.PERSISTENCE_BACKEND = savedBackend || '';
    process.env.LOG_AUTO_PRUNE = savedPrune || '';
    if (savedPersist === undefined) delete process.env.PERSIST_REQUEST_SECRETS;
    else process.env.PERSIST_REQUEST_SECRETS = savedPersist;
  });

  it('DEFAULT: stores the complete request/response INCLUDING secrets', async () => {
    const service = await makeService();
    record(service);
    const row = rowsOf(service)[0];
    expect(row.requestBody).toContain('super-secret');
    expect(row.requestHeaders).toContain('Basic dXNlcjpzZWNyZXQ=');
    expect(row.responseBody).toContain('jwt.value.here');
    await service.onModuleDestroy?.();
  });

  it('server env PERSIST_REQUEST_SECRETS=false: redacts secrets before persist', async () => {
    process.env.PERSIST_REQUEST_SECRETS = 'false';
    const service = await makeService();
    record(service);
    const row = rowsOf(service)[0];
    expect(row.requestBody).not.toContain('super-secret');
    expect(row.requestBody).toContain('[REDACTED]');
    expect(row.requestBody).toContain('client_credentials'); // non-secret preserved
    expect(row.requestHeaders).not.toContain('Basic dXNlcjpzZWNyZXQ=');
    expect(row.responseBody).not.toContain('jwt.value.here');
    await service.onModuleDestroy?.();
  });

  it('endpoint PersistRequestSecrets=false OVERRIDES a true server default', async () => {
    // Server default true (env unset); endpoint explicitly opts into redaction.
    // The id must be a real UUID: `RequestLog.endpointId` is `@db.Uuid` and is
    // now coerced to null at the persistence boundary, so a placeholder like
    // 'ep-redact' would silently drop the correlation this test asserts.
    // See storable-uuid.ts.
    const epRedact = 'e9ed4c70-1a3f-4a2e-9f4a-2b7c5d1e0001';
    cachedSettings = { PersistRequestSecrets: false };
    const service = await makeService();
    record(service, epRedact);
    const row = rowsOf(service)[0];
    expect(row.endpointId).toBe(epRedact);
    expect(row.requestBody).not.toContain('super-secret');
    expect(row.requestBody).toContain('[REDACTED]');
    await service.onModuleDestroy?.();
  });

  it('endpoint PersistRequestSecrets=true OVERRIDES a false server default', async () => {
    process.env.PERSIST_REQUEST_SECRETS = 'false';
    cachedSettings = { PersistRequestSecrets: true };
    const service = await makeService();
    record(service, 'ep-keep');
    const row = rowsOf(service)[0];
    expect(row.requestBody).toContain('super-secret');
    await service.onModuleDestroy?.();
  });
});
