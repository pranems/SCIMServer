import { Test, TestingModule } from '@nestjs/testing';
import { LoggingService } from './logging.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScimLogger } from './scim-logger.service';

describe('LoggingService.recordRequest - health-probe filter', () => {
  let service: LoggingService;
  let prisma: {
    requestLog: {
      deleteMany: jest.Mock;
      count: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      createMany: jest.Mock;
    };
  };
  let logger: {
    info: jest.Mock;
    error: jest.Mock;
    debug: jest.Mock;
    warn: jest.Mock;
    trace: jest.Mock;
  };

  beforeEach(async () => {
    process.env.PERSISTENCE_BACKEND = 'prisma';
    process.env.LOG_AUTO_PRUNE = 'false';

    prisma = {
      requestLog: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    logger = {
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
    await service.onModuleDestroy();
  });

  // Helper that fires a recordRequest call and forces the buffer to flush so
  // we can observe whether createMany was called.
  async function recordAndFlush(opts: Parameters<LoggingService['recordRequest']>[0]): Promise<void> {
    service.recordRequest(opts);
    await service.flushLogs();
  }

  describe('drops successful health probes (no DB write)', () => {
    const successCases: Array<{ url: string; status: number; description: string }> = [
      { url: '/health',            status: 200, description: 'bare /health 200' },
      { url: '/health',            status: 204, description: 'bare /health 204' },
      { url: '/scim/health',       status: 200, description: 'prefixed /scim/health 200' },
      { url: '/scim/health/',      status: 200, description: 'prefixed /scim/health/ 200 (trailing slash)' },
      { url: '/scim/health?ts=42', status: 200, description: 'prefixed /scim/health with query string' },
      { url: '/health',            status: 304, description: '304 Not Modified is treated as success' },
    ];

    for (const c of successCases) {
      it(`skips ${c.description}`, async () => {
        await recordAndFlush({
          method: 'GET',
          url: c.url,
          status: c.status,
          requestHeaders: {},
        });
        expect(prisma.requestLog.createMany).not.toHaveBeenCalled();
      });
    }
  });

  describe('still records health-related rows that need diagnostics', () => {
    it('records a 500 on /scim/health (server failure)', async () => {
      await recordAndFlush({
        method: 'GET',
        url: '/scim/health',
        status: 500,
        requestHeaders: {},
        error: new Error('boom'),
      });
      expect(prisma.requestLog.createMany).toHaveBeenCalled();
    });

    it('records a 503 on /health (probe-induced failure)', async () => {
      await recordAndFlush({
        method: 'GET',
        url: '/health',
        status: 503,
        requestHeaders: {},
      });
      expect(prisma.requestLog.createMany).toHaveBeenCalled();
    });

    it('records a POST to /scim/health (unexpected verb -> still interesting)', async () => {
      await recordAndFlush({
        method: 'POST',
        url: '/scim/health',
        status: 405,
        requestHeaders: {},
      });
      expect(prisma.requestLog.createMany).toHaveBeenCalled();
    });

    it('records when error is set even with a 2xx status (defensive)', async () => {
      await recordAndFlush({
        method: 'GET',
        url: '/scim/health',
        status: 200,
        requestHeaders: {},
        error: new Error('post-response failure'),
      });
      expect(prisma.requestLog.createMany).toHaveBeenCalled();
    });
  });

  describe('does not match unrelated SCIM URLs that contain "health"', () => {
    it('records GET /scim/Users?filter=health (substring on a non-health endpoint)', async () => {
      await recordAndFlush({
        method: 'GET',
        url: '/scim/Users?filter=userName co "health"',
        status: 200,
        requestHeaders: {},
      });
      expect(prisma.requestLog.createMany).toHaveBeenCalled();
    });

    it('records GET /scim/HealthCheckers (different resource happening to start the same)', async () => {
      await recordAndFlush({
        method: 'GET',
        url: '/scim/HealthCheckers',
        status: 200,
        requestHeaders: {},
      });
      expect(prisma.requestLog.createMany).toHaveBeenCalled();
    });
  });
});
