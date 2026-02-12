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
});
