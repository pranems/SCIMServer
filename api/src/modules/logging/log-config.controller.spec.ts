import { LogConfigController } from './log-config.controller';
import { ScimLogger } from './scim-logger.service';
import { LogLevel, LogCategory } from './log-levels';

describe('LogConfigController', () => {
  let controller: LogConfigController;
  let scimLogger: ScimLogger;

  // Suppress console output
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;
  let consoleSpy: jest.SpyInstance;
  let consoleDebugSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'TRACE';
    process.env.LOG_FORMAT = 'json';

    scimLogger = new ScimLogger();
    controller = new LogConfigController(scimLogger);

    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleDebugSpy = jest.spyOn(console, 'debug').mockImplementation();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleDebugSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  // ─── GET /admin/log-config ────────────────────────────────────────

  describe('getConfig', () => {
    it('should return the current configuration', () => {
      const result = controller.getConfig();
      expect(result).toHaveProperty('globalLevel');
      expect(result).toHaveProperty('categoryLevels');
      expect(result).toHaveProperty('endpointLevels');
      expect(result).toHaveProperty('includePayloads');
      expect(result).toHaveProperty('includeStackTraces');
      expect(result).toHaveProperty('maxPayloadSizeBytes');
      expect(result).toHaveProperty('format');
      expect(result).toHaveProperty('availableLevels');
      expect(result).toHaveProperty('availableCategories');
    });

    it('should return string level names (not numbers)', () => {
      const result = controller.getConfig();
      expect(typeof result.globalLevel).toBe('string');
      expect(result.globalLevel).toBe('TRACE');
    });

    it('should include all available levels', () => {
      const result = controller.getConfig();
      expect(result.availableLevels).toContain('TRACE');
      expect(result.availableLevels).toContain('DEBUG');
      expect(result.availableLevels).toContain('INFO');
      expect(result.availableLevels).toContain('WARN');
      expect(result.availableLevels).toContain('ERROR');
      expect(result.availableLevels).toContain('FATAL');
      expect(result.availableLevels).toContain('OFF');
    });

    it('should include all available categories', () => {
      const result = controller.getConfig();
      expect(result.availableCategories).toHaveLength(12);
      expect(result.availableCategories).toContain('http');
      expect(result.availableCategories).toContain('scim.user');
      expect(result.availableCategories).toContain('scim.patch');
    });

    it('should reflect category level overrides as strings', () => {
      scimLogger.setCategoryLevel(LogCategory.SCIM_PATCH, LogLevel.TRACE);
      const result = controller.getConfig();
      expect(result.categoryLevels['scim.patch']).toBe('TRACE');
    });

    it('should reflect endpoint level overrides as strings', () => {
      scimLogger.setEndpointLevel('ep-test', LogLevel.DEBUG);
      const result = controller.getConfig();
      expect(result.endpointLevels['ep-test']).toBe('DEBUG');
    });
  });

  // ─── PUT /admin/log-config ────────────────────────────────────────

  describe('updateConfig', () => {
    it('should update global level', () => {
      const result = controller.updateConfig({ globalLevel: 'WARN' });
      expect(result.message).toBe('Log configuration updated');
      expect(result.config.globalLevel).toBe('WARN');
    });

    it('should update includePayloads', () => {
      const result = controller.updateConfig({ includePayloads: false });
      expect(result.config.includePayloads).toBe(false);
    });

    it('should update includeStackTraces', () => {
      const result = controller.updateConfig({ includeStackTraces: false });
      expect(result.config.includeStackTraces).toBe(false);
    });

    it('should update maxPayloadSizeBytes', () => {
      const result = controller.updateConfig({ maxPayloadSizeBytes: 2048 });
      expect(result.config.maxPayloadSizeBytes).toBe(2048);
    });

    it('should update format to json', () => {
      scimLogger.updateConfig({ format: 'pretty' });
      const result = controller.updateConfig({ format: 'json' });
      expect(result.config.format).toBe('json');
    });

    it('should update format to pretty', () => {
      const result = controller.updateConfig({ format: 'pretty' });
      expect(result.config.format).toBe('pretty');
    });

    it('should update category levels', () => {
      const result = controller.updateConfig({
        categoryLevels: { 'scim.patch': 'TRACE', 'auth': 'WARN' },
      });
      expect(result.config.categoryLevels['scim.patch']).toBe('TRACE');
      expect(result.config.categoryLevels['auth']).toBe('WARN');
    });

    it('should ignore invalid category names', () => {
      const result = controller.updateConfig({
        categoryLevels: { 'invalidCategory': 'DEBUG', 'http': 'WARN' },
      });
      expect(result.config.categoryLevels['http']).toBe('WARN');
      // Invalid category should not appear
      expect(result.config.categoryLevels['invalidCategory']).toBeUndefined();
    });

    it('should handle empty body gracefully', () => {
      const result = controller.updateConfig({});
      expect(result.message).toBe('Log configuration updated');
      // Config should be unchanged
      expect(result.config.globalLevel).toBe('TRACE');
    });

    it('should ignore non-boolean includePayloads', () => {
      const result = controller.updateConfig({ includePayloads: 'yes' as unknown as boolean });
      // Should not crash, should remain as-is
      expect(result.config.includePayloads).toBeDefined();
    });
  });

  // ─── PUT /admin/log-config/level/:level ───────────────────────────

  describe('setGlobalLevel', () => {
    it('should set the global log level', () => {
      const result = controller.setGlobalLevel('ERROR');
      expect(result.message).toBe('Global log level set to ERROR');
      expect(result.globalLevel).toBe('ERROR');
    });

    it('should handle case-insensitive levels', () => {
      const result = controller.setGlobalLevel('trace');
      expect(result.globalLevel).toBe('TRACE');
    });
  });

  // ─── PUT /admin/log-config/category/:cat/:level ───────────────────

  describe('setCategoryLevel', () => {
    it('should set a category level', () => {
      const result = controller.setCategoryLevel('scim.patch', 'TRACE');
      expect(result.message).toBe("Category 'scim.patch' log level set to TRACE");
    });

    it('should return error for unknown category', () => {
      const result = controller.setCategoryLevel('nonexistent', 'DEBUG');
      expect(result).toHaveProperty('error');
      expect(result.error).toContain("Unknown category 'nonexistent'");
      expect(result.availableCategories).toHaveLength(12);
    });

    it('should accept all valid categories', () => {
      for (const cat of Object.values(LogCategory)) {
        const result = controller.setCategoryLevel(cat, 'INFO');
        expect(result.message).toContain(cat);
      }
    });
  });

  // ─── PUT /admin/log-config/endpoint/:id/:level ────────────────────

  describe('setEndpointLevel', () => {
    it('should set an endpoint level override', () => {
      const result = controller.setEndpointLevel('ep-123', 'TRACE');
      expect(result.message).toBe("Endpoint 'ep-123' log level set to TRACE");
    });

    it('should update the underlying logger config', () => {
      controller.setEndpointLevel('ep-456', 'DEBUG');
      const config = scimLogger.getConfig();
      expect(config.endpointLevels['ep-456']).toBe(LogLevel.DEBUG);
    });
  });

  // ─── DELETE /admin/log-config/endpoint/:id ────────────────────────

  describe('clearEndpointLevel', () => {
    it('should remove endpoint override (returns undefined)', () => {
      scimLogger.setEndpointLevel('ep-789', LogLevel.TRACE);
      controller.clearEndpointLevel('ep-789');
      expect(scimLogger.getConfig().endpointLevels['ep-789']).toBeUndefined();
    });

    it('should be a no-op for non-existent endpoint', () => {
      // Should not throw
      controller.clearEndpointLevel('ep-nonexistent');
    });
  });

  // ─── GET /admin/log-config/recent ─────────────────────────────────

  describe('getRecentLogs', () => {
    beforeEach(() => {
      scimLogger.clearRecentLogs();
    });

    it('should return recent log entries with count', () => {
      scimLogger.info(LogCategory.HTTP, 'test entry');
      const result = controller.getRecentLogs();
      expect(result.count).toBe(1);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].message).toBe('test entry');
    });

    it('should respect limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        scimLogger.info(LogCategory.HTTP, `entry ${i}`);
      }
      const result = controller.getRecentLogs('3');
      expect(result.count).toBe(3);
      expect(result.entries).toHaveLength(3);
    });

    it('should filter by level', () => {
      scimLogger.info(LogCategory.HTTP, 'info');
      scimLogger.warn(LogCategory.HTTP, 'warning');
      scimLogger.error(LogCategory.HTTP, 'error', new Error('e'));

      const result = controller.getRecentLogs(undefined, 'ERROR');
      expect(result.count).toBe(1);
      expect(result.entries[0].level).toBe('ERROR');
    });

    it('should filter by category', () => {
      scimLogger.info(LogCategory.HTTP, 'http entry');
      scimLogger.info(LogCategory.AUTH, 'auth entry');

      const result = controller.getRecentLogs(undefined, undefined, 'auth');
      expect(result.count).toBe(1);
      expect(result.entries[0].category).toBe('auth');
    });

    it('should filter by requestId', () => {
      scimLogger.runWithContext({ requestId: 'req-specific' }, () => {
        scimLogger.info(LogCategory.HTTP, 'specific request');
      });
      scimLogger.info(LogCategory.HTTP, 'no request');

      const result = controller.getRecentLogs(undefined, undefined, undefined, 'req-specific');
      expect(result.count).toBe(1);
      expect(result.entries[0].requestId).toBe('req-specific');
    });

    it('should filter by endpointId', () => {
      scimLogger.runWithContext({ requestId: 'r1', endpointId: 'ep-target' }, () => {
        scimLogger.info(LogCategory.HTTP, 'target endpoint');
      });
      scimLogger.info(LogCategory.HTTP, 'no endpoint');

      const result = controller.getRecentLogs(undefined, undefined, undefined, undefined, 'ep-target');
      expect(result.count).toBe(1);
      expect(result.entries[0].endpointId).toBe('ep-target');
    });

    it('should return empty array when no logs match', () => {
      const result = controller.getRecentLogs(undefined, 'FATAL');
      expect(result.count).toBe(0);
      expect(result.entries).toHaveLength(0);
    });
  });

  // ─── DELETE /admin/log-config/recent ──────────────────────────────

  describe('clearRecentLogs', () => {
    it('should clear all entries from the ring buffer', () => {
      scimLogger.info(LogCategory.HTTP, 'entry');
      expect(scimLogger.getRecentLogs()).toHaveLength(1);

      controller.clearRecentLogs();
      expect(scimLogger.getRecentLogs()).toHaveLength(0);
    });
  });

  // ─── GET /admin/log-config/stream (SSE) ───────────────────────────

  describe('streamLogs (SSE)', () => {
    function createMockResponse() {
      const chunks: string[] = [];
      const headers: Record<string, string> = {};
      const res = {
        setHeader: jest.fn((key: string, value: string) => { headers[key] = value; }),
        flushHeaders: jest.fn(),
        write: jest.fn((data: string) => { chunks.push(data); return true; }),
        end: jest.fn(),
        on: jest.fn(),
        chunks,
        headers,
      };
      return res;
    }

    it('should set SSE headers', () => {
      const res = createMockResponse();
      controller.streamLogs(undefined, undefined, undefined, res as never);
      expect(res.headers['Content-Type']).toBe('text/event-stream');
      expect(res.headers['Cache-Control']).toBe('no-cache');
      expect(res.headers['Connection']).toBe('keep-alive');
      expect(res.headers['X-Accel-Buffering']).toBe('no');
      expect(res.flushHeaders).toHaveBeenCalled();
    });

    it('should send initial connected event', () => {
      const res = createMockResponse();
      controller.streamLogs(undefined, undefined, undefined, res as never);
      expect(res.chunks[0]).toContain('event: connected');
      expect(res.chunks[0]).toContain('Log stream connected');
    });

    it('should stream log entries in real-time', () => {
      const res = createMockResponse();
      controller.streamLogs(undefined, undefined, undefined, res as never);
      const initialCount = res.chunks.length;

      // Emit a log entry
      scimLogger.info(LogCategory.HTTP, 'streamed entry');

      expect(res.chunks.length).toBeGreaterThan(initialCount);
      const lastChunk = res.chunks[res.chunks.length - 1];
      expect(lastChunk).toContain('data:');
      expect(lastChunk).toContain('streamed entry');

      // Trigger cleanup (simulate disconnect)
      const closeHandler = (res.on as jest.Mock).mock.calls.find(
        (call: [string, () => void]) => call[0] === 'close'
      );
      if (closeHandler) closeHandler[1]();
    });

    it('should filter by level', () => {
      const res = createMockResponse();
      controller.streamLogs('WARN', undefined, undefined, res as never);
      const afterConnect = res.chunks.length;

      scimLogger.info(LogCategory.HTTP, 'info entry - should be filtered');
      expect(res.chunks.length).toBe(afterConnect); // no new chunk

      scimLogger.warn(LogCategory.HTTP, 'warn entry - should pass');
      expect(res.chunks.length).toBe(afterConnect + 1);

      // Cleanup
      const closeHandler = (res.on as jest.Mock).mock.calls.find(
        (call: [string, () => void]) => call[0] === 'close'
      );
      if (closeHandler) closeHandler[1]();
    });

    it('should filter by category', () => {
      const res = createMockResponse();
      controller.streamLogs(undefined, 'auth', undefined, res as never);
      const afterConnect = res.chunks.length;

      scimLogger.info(LogCategory.HTTP, 'http entry - should be filtered');
      expect(res.chunks.length).toBe(afterConnect);

      scimLogger.info(LogCategory.AUTH, 'auth entry - should pass');
      expect(res.chunks.length).toBe(afterConnect + 1);

      // Cleanup
      const closeHandler = (res.on as jest.Mock).mock.calls.find(
        (call: [string, () => void]) => call[0] === 'close'
      );
      if (closeHandler) closeHandler[1]();
    });

    it('should filter by endpointId', () => {
      const res = createMockResponse();
      controller.streamLogs(undefined, undefined, 'ep-123', res as never);
      const afterConnect = res.chunks.length;

      scimLogger.info(LogCategory.HTTP, 'no endpoint');
      expect(res.chunks.length).toBe(afterConnect);

      scimLogger.runWithContext({ requestId: 'r1', endpointId: 'ep-123' }, () => {
        scimLogger.info(LogCategory.HTTP, 'target endpoint');
      });
      expect(res.chunks.length).toBe(afterConnect + 1);

      // Cleanup
      const closeHandler = (res.on as jest.Mock).mock.calls.find(
        (call: [string, () => void]) => call[0] === 'close'
      );
      if (closeHandler) closeHandler[1]();
    });

    it('should unsubscribe on close', () => {
      const res = createMockResponse();
      controller.streamLogs(undefined, undefined, undefined, res as never);
      const afterConnect = res.chunks.length;

      // Trigger close
      const closeHandler = (res.on as jest.Mock).mock.calls.find(
        (call: [string, () => void]) => call[0] === 'close'
      );
      expect(closeHandler).toBeDefined();
      closeHandler![1]();

      // New log should NOT appear
      scimLogger.info(LogCategory.HTTP, 'after disconnect');
      expect(res.chunks.length).toBe(afterConnect);
      expect(res.end).toHaveBeenCalled();
    });
  });

  // ─── GET /admin/log-config/download ───────────────────────────────

  describe('downloadLogs', () => {
    function createMockResponse() {
      const headers: Record<string, string> = {};
      let body = '';
      const res = {
        setHeader: jest.fn((key: string, value: string) => { headers[key] = value; }),
        send: jest.fn((data: string) => { body = data; }),
        headers,
        get body() { return body; },
      };
      return res;
    }

    beforeEach(() => {
      scimLogger.clearRecentLogs();
      scimLogger.info(LogCategory.HTTP, 'log entry 1');
      scimLogger.warn(LogCategory.AUTH, 'log entry 2');
      scimLogger.error(LogCategory.DATABASE, 'log entry 3', new Error('db issue'));
    });

    it('should default to NDJSON format', () => {
      const res = createMockResponse();
      controller.downloadLogs(undefined, undefined, undefined, undefined, undefined, undefined, res as never);
      expect(res.headers['Content-Type']).toBe('application/x-ndjson');
      expect(res.headers['Content-Disposition']).toContain('attachment');
      expect(res.headers['Content-Disposition']).toContain('.ndjson');
    });

    it('should support JSON format', () => {
      const res = createMockResponse();
      controller.downloadLogs('json', undefined, undefined, undefined, undefined, undefined, res as never);
      expect(res.headers['Content-Type']).toBe('application/json');
      expect(res.headers['Content-Disposition']).toContain('.json');
      const parsed = JSON.parse(res.body);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(3);
    });

    it('should produce valid NDJSON with all entries', () => {
      const res = createMockResponse();
      controller.downloadLogs(undefined, undefined, undefined, undefined, undefined, undefined, res as never);
      const lines = res.body.trim().split('\n');
      expect(lines).toHaveLength(3);
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    });

    it('should filter by level', () => {
      const res = createMockResponse();
      controller.downloadLogs(undefined, undefined, 'ERROR', undefined, undefined, undefined, res as never);
      const lines = res.body.trim().split('\n');
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]).level).toBe('ERROR');
    });

    it('should filter by category', () => {
      const res = createMockResponse();
      controller.downloadLogs(undefined, undefined, undefined, 'auth', undefined, undefined, res as never);
      const lines = res.body.trim().split('\n');
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]).category).toBe('auth');
    });

    it('should include timestamp in filename', () => {
      const res = createMockResponse();
      controller.downloadLogs(undefined, undefined, undefined, undefined, undefined, undefined, res as never);
      expect(res.headers['Content-Disposition']).toMatch(/scimserver-logs-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/);
    });

    it('should respect limit parameter', () => {
      const res = createMockResponse();
      controller.downloadLogs(undefined, '2', undefined, undefined, undefined, undefined, res as never);
      const lines = res.body.trim().split('\n');
      expect(lines).toHaveLength(2);
    });
  });
});
