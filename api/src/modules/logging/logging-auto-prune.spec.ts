import { Test, TestingModule } from '@nestjs/testing';
import { LoggingService } from './logging.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScimLogger } from './scim-logger.service';

describe('LoggingService — Auto-Prune', () => {
  let service: LoggingService;
  let prisma: { requestLog: { deleteMany: jest.Mock; count: jest.Mock; findMany: jest.Mock; create: jest.Mock; createMany: jest.Mock } };
  let logger: { info: jest.Mock; error: jest.Mock; debug: jest.Mock; warn: jest.Mock; trace: jest.Mock };

  beforeEach(async () => {
    // Ensure prisma backend for auto-prune tests
    const savedBackend = process.env.PERSISTENCE_BACKEND;
    const savedPrune = process.env.LOG_AUTO_PRUNE;
    const savedRetention = process.env.LOG_RETENTION_DAYS;
    const savedInterval = process.env.LOG_PRUNE_INTERVAL_MS;

    process.env.PERSISTENCE_BACKEND = 'prisma';
    process.env.LOG_AUTO_PRUNE = 'false'; // Disable auto-init to control manually
    process.env.LOG_RETENTION_DAYS = '7';
    process.env.LOG_PRUNE_INTERVAL_MS = '3600000';

    prisma = {
      requestLog: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        createMany: jest.fn(),
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

    // Restore env
    process.env.PERSISTENCE_BACKEND = savedBackend || '';
    process.env.LOG_AUTO_PRUNE = savedPrune || '';
    process.env.LOG_RETENTION_DAYS = savedRetention || '';
    process.env.LOG_PRUNE_INTERVAL_MS = savedInterval || '';
  });

  afterEach(async () => {
    // Clean up any timers the service might have started
    await service.onModuleDestroy();
  });

  describe('getAutoPruneConfig', () => {
    it('should return current config with defaults from env', () => {
      const config = service.getAutoPruneConfig();
      expect(config).toHaveProperty('enabled');
      expect(config).toHaveProperty('retentionDays');
      expect(config).toHaveProperty('intervalMs');
      expect(typeof config.enabled).toBe('boolean');
      expect(typeof config.retentionDays).toBe('number');
      expect(typeof config.intervalMs).toBe('number');
    });
  });

  describe('setAutoPruneConfig', () => {
    it('should update retentionDays when valid', () => {
      service.setAutoPruneConfig({ retentionDays: 30 });
      expect(service.getAutoPruneConfig().retentionDays).toBe(30);
    });

    it('should update intervalMs when >= 60000', () => {
      service.setAutoPruneConfig({ intervalMs: 120_000 });
      expect(service.getAutoPruneConfig().intervalMs).toBe(120_000);
    });

    it('should not update intervalMs when < 60000', () => {
      const before = service.getAutoPruneConfig().intervalMs;
      service.setAutoPruneConfig({ intervalMs: 5_000 });
      expect(service.getAutoPruneConfig().intervalMs).toBe(before);
    });

    it('should not update retentionDays when <= 0', () => {
      const before = service.getAutoPruneConfig().retentionDays;
      service.setAutoPruneConfig({ retentionDays: 0 });
      expect(service.getAutoPruneConfig().retentionDays).toBe(before);
      service.setAutoPruneConfig({ retentionDays: -1 });
      expect(service.getAutoPruneConfig().retentionDays).toBe(before);
    });

    it('should update enabled flag', () => {
      service.setAutoPruneConfig({ enabled: true });
      expect(service.getAutoPruneConfig().enabled).toBe(true);
      service.setAutoPruneConfig({ enabled: false });
      expect(service.getAutoPruneConfig().enabled).toBe(false);
    });

    it('should log config update', () => {
      service.setAutoPruneConfig({ retentionDays: 14 });
      expect(logger.info).toHaveBeenCalledWith(
        expect.any(String), // LogCategory.CONFIG
        expect.stringContaining('Auto-prune config updated'),
      );
    });
  });

  describe('pruneOldLogs (existing method)', () => {
    it('should call prisma.requestLog.deleteMany with date cutoff', async () => {
      prisma.requestLog.deleteMany.mockResolvedValue({ count: 42 });
      const result = await service.pruneOldLogs(7);
      expect(result).toBe(42);
      expect(prisma.requestLog.deleteMany).toHaveBeenCalledWith({
        where: { createdAt: { lt: expect.any(Date) } },
      });
    });

    it('should log the prune result', async () => {
      prisma.requestLog.deleteMany.mockResolvedValue({ count: 10 });
      await service.pruneOldLogs(1);
      expect(logger.info).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('Pruned 10 log entries'),
      );
    });
  });

  describe('onModuleInit', () => {
    it('should not start timer when auto-prune is disabled', async () => {
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      const initialTimeouts = setTimeoutSpy.mock.calls.length;
      const initialIntervals = setIntervalSpy.mock.calls.length;

      await service.onModuleInit();

      expect(setTimeoutSpy.mock.calls.length).toBe(initialTimeouts);
      expect(setIntervalSpy.mock.calls.length).toBe(initialIntervals);

      setTimeoutSpy.mockRestore();
      setIntervalSpy.mockRestore();
    });

    it('should start timers when auto-prune is enabled', async () => {
      service.setAutoPruneConfig({ enabled: true });

      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      const beforeTimeout = setTimeoutSpy.mock.calls.length;
      const beforeInterval = setIntervalSpy.mock.calls.length;

      await service.onModuleInit();

      // Should have added a delayed initial prune (setTimeout) and recurring (setInterval)
      expect(setTimeoutSpy.mock.calls.length).toBeGreaterThan(beforeTimeout);
      expect(setIntervalSpy.mock.calls.length).toBeGreaterThan(beforeInterval);

      setTimeoutSpy.mockRestore();
      setIntervalSpy.mockRestore();
    });

    it('should log when auto-prune is enabled on init', async () => {
      service.setAutoPruneConfig({ enabled: true });
      await service.onModuleInit();
      expect(logger.info).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('Auto-prune enabled'),
      );
    });
  });

  describe('runAutoPrune (via pruneOldLogs)', () => {
    it('should handle pruneOldLogs errors gracefully', async () => {
      prisma.requestLog.deleteMany.mockRejectedValue(new Error('DB connection lost'));
      // pruneOldLogs will throw — runAutoPrune catches it
      // We test directly that pruneOldLogs throws
      await expect(service.pruneOldLogs(1)).rejects.toThrow('DB connection lost');
    });

    it('should prune with the configured retention days', async () => {
      service.setAutoPruneConfig({ retentionDays: 14 });
      prisma.requestLog.deleteMany.mockResolvedValue({ count: 5 });
      
      const result = await service.pruneOldLogs(service.getAutoPruneConfig().retentionDays);
      expect(result).toBe(5);
      
      // Verify the cutoff date is ~14 days ago
      const call = prisma.requestLog.deleteMany.mock.calls[0][0];
      const cutoff = call.where.createdAt.lt as Date;
      const daysAgo = (Date.now() - cutoff.getTime()) / (24 * 60 * 60 * 1000);
      expect(daysAgo).toBeGreaterThan(13.9);
      expect(daysAgo).toBeLessThan(14.1);
    });
  });

  describe('onModuleDestroy', () => {
    it('should clear auto-prune timer on shutdown', async () => {
      // Simulate a running timer by calling setAutoPruneConfig with enabled=true
      service.setAutoPruneConfig({ enabled: true });
      await service.onModuleDestroy();
      // Should not throw, timer cleared
    });
  });
});
