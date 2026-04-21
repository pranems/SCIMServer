import { EndpointLogController } from './endpoint-log.controller';
import { LogQueryService } from '../../logging/log-query.service';
import { ScimLogger, type StructuredLogEntry } from '../../logging/scim-logger.service';
import { LogLevel, LogCategory } from '../../logging/log-levels';

describe('EndpointLogController', () => {
  let controller: EndpointLogController;
  let logQuery: LogQueryService;
  let scimLogger: ScimLogger;

  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;
  let consoleSpy: jest.SpyInstance;
  let consoleDebugSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env.LOG_LEVEL = 'TRACE';
    process.env.LOG_FORMAT = 'json';

    scimLogger = new ScimLogger();
    logQuery = new LogQueryService(scimLogger);
    controller = new EndpointLogController(logQuery);

    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleDebugSpy = jest.spyOn(console, 'debug').mockImplementation();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleDebugSpy.mockRestore();
  });

  describe('getRecentLogs', () => {
    beforeEach(() => {
      scimLogger.runWithContext({ requestId: 'r1', endpointId: 'ep-aaa' }, () => {
        scimLogger.info(LogCategory.SCIM_USER, 'User created');
      });
      scimLogger.runWithContext({ requestId: 'r2', endpointId: 'ep-bbb' }, () => {
        scimLogger.info(LogCategory.SCIM_GROUP, 'Group created');
      });
      scimLogger.runWithContext({ requestId: 'r3', endpointId: 'ep-aaa' }, () => {
        scimLogger.warn(LogCategory.SCIM_PATCH, 'ReadOnly stripped');
      });
    });

    it('should return only entries for the specified endpoint', () => {
      const result = controller.getRecentLogs('ep-aaa');
      expect(result.endpointId).toBe('ep-aaa');
      expect(result.count).toBe(2);
      expect(result.entries.every(e => e.endpointId === 'ep-aaa')).toBe(true);
    });

    it('should not return entries from other endpoints', () => {
      const result = controller.getRecentLogs('ep-bbb');
      expect(result.count).toBe(1);
      expect(result.entries[0].category).toBe('scim.group');
    });

    it('should support level filter', () => {
      const result = controller.getRecentLogs('ep-aaa', undefined, 'WARN');
      expect(result.count).toBe(1);
      expect(result.entries[0].level).toBe('WARN');
    });

    it('should support category filter', () => {
      const result = controller.getRecentLogs('ep-aaa', undefined, undefined, 'scim.user');
      expect(result.count).toBe(1);
    });

    it('should support requestId filter', () => {
      const result = controller.getRecentLogs('ep-aaa', undefined, undefined, undefined, 'r1');
      expect(result.count).toBe(1);
    });

    it('should return empty for nonexistent endpoint', () => {
      const result = controller.getRecentLogs('ep-nonexistent');
      expect(result.count).toBe(0);
    });

    it('should support limit parameter', () => {
      const result = controller.getRecentLogs('ep-aaa', '1');
      expect(result.count).toBe(1);
    });

    it('should filter by HTTP method', () => {
      scimLogger.runWithContext({ requestId: 'r4', endpointId: 'ep-mf', method: 'POST' }, () => {
        scimLogger.info(LogCategory.SCIM_USER, 'POST entry');
      });
      scimLogger.runWithContext({ requestId: 'r5', endpointId: 'ep-mf', method: 'GET' }, () => {
        scimLogger.info(LogCategory.SCIM_USER, 'GET entry');
      });

      const result = controller.getRecentLogs('ep-mf', undefined, undefined, undefined, undefined, 'POST');
      expect(result.count).toBe(1);
      expect(result.entries[0].method).toBe('POST');
    });
  });

  describe('streamLogs', () => {
    it('should send SSE connected event with endpointId', () => {
      const written: string[] = [];
      const mockRes = {
        setHeader: jest.fn(), flushHeaders: jest.fn(),
        write: jest.fn((data: string) => written.push(data)),
        on: jest.fn(), end: jest.fn(),
      } as any;

      controller.streamLogs('ep-test', undefined, undefined, mockRes);
      expect(written[0]).toContain('event: connected');
      expect(written[0]).toContain('ep-test');

      const closeHandler = mockRes.on.mock.calls.find((c: any[]) => c[0] === 'close')?.[1];
      if (closeHandler) closeHandler();
    });

    it('should filter SSE events by endpointId', (done) => {
      const written: string[] = [];
      const mockRes = {
        setHeader: jest.fn(), flushHeaders: jest.fn(),
        write: jest.fn((data: string) => written.push(data)),
        on: jest.fn(), end: jest.fn(),
      } as any;

      controller.streamLogs('ep-filter-test', undefined, undefined, mockRes);

      scimLogger.runWithContext({ requestId: 'r1', endpointId: 'ep-filter-test' }, () => {
        scimLogger.info(LogCategory.HTTP, 'Should arrive');
      });
      scimLogger.runWithContext({ requestId: 'r2', endpointId: 'ep-other' }, () => {
        scimLogger.info(LogCategory.HTTP, 'Should NOT arrive');
      });

      setTimeout(() => {
        const dataLines = written.filter(w => w.startsWith('data:') && !w.includes('connected'));
        expect(dataLines.length).toBe(1);
        expect(dataLines[0]).toContain('Should arrive');
        const closeHandler = mockRes.on.mock.calls.find((c: any[]) => c[0] === 'close')?.[1];
        if (closeHandler) closeHandler();
        done();
      }, 50);
    });

    it('should filter SSE events by level', (done) => {
      const written: string[] = [];
      const mockRes = {
        setHeader: jest.fn(), flushHeaders: jest.fn(),
        write: jest.fn((data: string) => written.push(data)),
        on: jest.fn(), end: jest.fn(),
      } as any;

      controller.streamLogs('ep-lvl', 'WARN', undefined, mockRes);

      scimLogger.runWithContext({ requestId: 'r1', endpointId: 'ep-lvl' }, () => {
        scimLogger.info(LogCategory.HTTP, 'Filtered out');
        scimLogger.warn(LogCategory.HTTP, 'Should arrive');
      });

      setTimeout(() => {
        const dataLines = written.filter(w => w.startsWith('data:') && !w.includes('connected'));
        expect(dataLines.length).toBe(1);
        expect(dataLines[0]).toContain('Should arrive');
        const closeHandler = mockRes.on.mock.calls.find((c: any[]) => c[0] === 'close')?.[1];
        if (closeHandler) closeHandler();
        done();
      }, 50);
    });

    it('should filter SSE events by category', (done) => {
      const written: string[] = [];
      const mockRes = {
        setHeader: jest.fn(), flushHeaders: jest.fn(),
        write: jest.fn((data: string) => written.push(data)),
        on: jest.fn(), end: jest.fn(),
      } as any;

      controller.streamLogs('ep-cat', undefined, 'scim.user', mockRes);

      scimLogger.runWithContext({ requestId: 'r1', endpointId: 'ep-cat' }, () => {
        scimLogger.info(LogCategory.HTTP, 'Wrong category');
        scimLogger.info(LogCategory.SCIM_USER, 'Right category');
      });

      setTimeout(() => {
        const dataLines = written.filter(w => w.startsWith('data:') && !w.includes('connected'));
        expect(dataLines.length).toBe(1);
        expect(dataLines[0]).toContain('Right category');
        const closeHandler = mockRes.on.mock.calls.find((c: any[]) => c[0] === 'close')?.[1];
        if (closeHandler) closeHandler();
        done();
      }, 50);
    });
  });

  describe('downloadLogs', () => {
    beforeEach(() => {
      scimLogger.runWithContext({ requestId: 'dl1', endpointId: 'ep-dl' }, () => {
        scimLogger.info(LogCategory.SCIM_USER, 'DL entry 1');
      });
      scimLogger.runWithContext({ requestId: 'dl2', endpointId: 'ep-other' }, () => {
        scimLogger.info(LogCategory.SCIM_USER, 'Should not appear');
      });
    });

    it('should download only entries for the specified endpoint as NDJSON', () => {
      const mockRes = { setHeader: jest.fn(), send: jest.fn() } as any;
      controller.downloadLogs('ep-dl', undefined, undefined, undefined, undefined, undefined, mockRes);
      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'application/x-ndjson');
      const content = mockRes.send.mock.calls[0][0] as string;
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(1);
      expect(JSON.parse(lines[0]).endpointId).toBe('ep-dl');
    });

    it('should support JSON format', () => {
      const mockRes = { setHeader: jest.fn(), send: jest.fn() } as any;
      controller.downloadLogs('ep-dl', 'json', undefined, undefined, undefined, undefined, mockRes);
      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
    });

    it('should include endpointId in filename', () => {
      const mockRes = { setHeader: jest.fn(), send: jest.fn() } as any;
      controller.downloadLogs('ep-dl', undefined, undefined, undefined, undefined, undefined, mockRes);
      const dispositionCall = mockRes.setHeader.mock.calls.find((c: any[]) => c[0] === 'Content-Disposition');
      expect(dispositionCall[1]).toContain('ep-dl');
    });

    it('should support level filter on download', () => {
      const mockRes = { setHeader: jest.fn(), send: jest.fn() } as any;
      controller.downloadLogs('ep-dl', undefined, undefined, 'WARN', undefined, undefined, mockRes);
      const content = mockRes.send.mock.calls[0][0] as string;
      expect(content.trim()).toBe('');
    });
  });

  describe('getHistory (Step 4.2)', () => {
    it('should call loggingService.listLogs with indexed endpointId filter', async () => {
      const mockLoggingService = {
        listLogs: jest.fn().mockResolvedValue({ total: 0, items: [], page: 1, pageSize: 50, count: 0, hasNext: false, hasPrev: false }),
      };
      const controllerWithHistory = new EndpointLogController(logQuery, mockLoggingService as any);

      await controllerWithHistory.getHistory('ep-hist-123', '1', '20');

      expect(mockLoggingService.listLogs).toHaveBeenCalledWith(
        expect.objectContaining({
          endpointId: 'ep-hist-123',
          page: 1,
          pageSize: 20,
        }),
      );
      // Should NOT use fragile urlContains string matching
      const callArgs = mockLoggingService.listLogs.mock.calls[0][0];
      expect(callArgs.urlContains).toBeUndefined();
    });
  });
});
