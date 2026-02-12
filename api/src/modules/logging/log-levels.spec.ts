import {
  LogLevel,
  LogCategory,
  parseLogLevel,
  logLevelName,
  buildDefaultLogConfig,
} from './log-levels';

describe('log-levels', () => {
  // ─── parseLogLevel ────────────────────────────────────────────────

  describe('parseLogLevel', () => {
    it('should return INFO for undefined input', () => {
      expect(parseLogLevel(undefined)).toBe(LogLevel.INFO);
    });

    it('should return INFO for empty string', () => {
      expect(parseLogLevel('')).toBe(LogLevel.INFO);
    });

    it('should parse TRACE (case-insensitive)', () => {
      expect(parseLogLevel('TRACE')).toBe(LogLevel.TRACE);
      expect(parseLogLevel('trace')).toBe(LogLevel.TRACE);
      expect(parseLogLevel('Trace')).toBe(LogLevel.TRACE);
    });

    it('should parse DEBUG', () => {
      expect(parseLogLevel('DEBUG')).toBe(LogLevel.DEBUG);
      expect(parseLogLevel('debug')).toBe(LogLevel.DEBUG);
    });

    it('should parse INFO', () => {
      expect(parseLogLevel('INFO')).toBe(LogLevel.INFO);
    });

    it('should parse WARN', () => {
      expect(parseLogLevel('WARN')).toBe(LogLevel.WARN);
    });

    it('should parse ERROR', () => {
      expect(parseLogLevel('ERROR')).toBe(LogLevel.ERROR);
    });

    it('should parse FATAL', () => {
      expect(parseLogLevel('FATAL')).toBe(LogLevel.FATAL);
    });

    it('should parse OFF', () => {
      expect(parseLogLevel('OFF')).toBe(LogLevel.OFF);
    });

    it('should handle leading/trailing whitespace', () => {
      expect(parseLogLevel('  DEBUG  ')).toBe(LogLevel.DEBUG);
    });

    it('should accept numeric string values', () => {
      expect(parseLogLevel('0')).toBe(LogLevel.TRACE);
      expect(parseLogLevel('1')).toBe(LogLevel.DEBUG);
      expect(parseLogLevel('2')).toBe(LogLevel.INFO);
      expect(parseLogLevel('3')).toBe(LogLevel.WARN);
      expect(parseLogLevel('4')).toBe(LogLevel.ERROR);
      expect(parseLogLevel('5')).toBe(LogLevel.FATAL);
      expect(parseLogLevel('6')).toBe(LogLevel.OFF);
    });

    it('should return INFO for out-of-range numeric values', () => {
      expect(parseLogLevel('-1')).toBe(LogLevel.INFO);
      expect(parseLogLevel('7')).toBe(LogLevel.INFO);
      expect(parseLogLevel('100')).toBe(LogLevel.INFO);
    });

    it('should return INFO for unknown strings', () => {
      expect(parseLogLevel('VERBOSE')).toBe(LogLevel.INFO);
      expect(parseLogLevel('nonsense')).toBe(LogLevel.INFO);
    });
  });

  // ─── logLevelName ─────────────────────────────────────────────────

  describe('logLevelName', () => {
    it('should return the string name for each level', () => {
      expect(logLevelName(LogLevel.TRACE)).toBe('TRACE');
      expect(logLevelName(LogLevel.DEBUG)).toBe('DEBUG');
      expect(logLevelName(LogLevel.INFO)).toBe('INFO');
      expect(logLevelName(LogLevel.WARN)).toBe('WARN');
      expect(logLevelName(LogLevel.ERROR)).toBe('ERROR');
      expect(logLevelName(LogLevel.FATAL)).toBe('FATAL');
      expect(logLevelName(LogLevel.OFF)).toBe('OFF');
    });

    it('should return UNKNOWN for invalid levels', () => {
      expect(logLevelName(99 as LogLevel)).toBe('UNKNOWN');
    });
  });

  // ─── LogCategory enum ────────────────────────────────────────────

  describe('LogCategory', () => {
    it('should have 12 categories', () => {
      const values = Object.values(LogCategory);
      expect(values).toHaveLength(12);
    });

    it('should include all expected category values', () => {
      expect(LogCategory.HTTP).toBe('http');
      expect(LogCategory.AUTH).toBe('auth');
      expect(LogCategory.SCIM_USER).toBe('scim.user');
      expect(LogCategory.SCIM_GROUP).toBe('scim.group');
      expect(LogCategory.SCIM_PATCH).toBe('scim.patch');
      expect(LogCategory.SCIM_FILTER).toBe('scim.filter');
      expect(LogCategory.SCIM_DISCOVERY).toBe('scim.discovery');
      expect(LogCategory.ENDPOINT).toBe('endpoint');
      expect(LogCategory.DATABASE).toBe('database');
      expect(LogCategory.BACKUP).toBe('backup');
      expect(LogCategory.OAUTH).toBe('oauth');
      expect(LogCategory.GENERAL).toBe('general');
    });
  });

  // ─── buildDefaultLogConfig ────────────────────────────────────────

  describe('buildDefaultLogConfig', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      // Reset env to a clean state before each test
      process.env = { ...originalEnv };
      delete process.env.LOG_LEVEL;
      delete process.env.LOG_FORMAT;
      delete process.env.LOG_INCLUDE_PAYLOADS;
      delete process.env.LOG_INCLUDE_STACKS;
      delete process.env.LOG_MAX_PAYLOAD_SIZE;
      delete process.env.LOG_CATEGORY_LEVELS;
      delete process.env.NODE_ENV;
    });

    afterAll(() => {
      process.env = originalEnv;
    });

    it('should return default config with INFO level when no env vars set', () => {
      const config = buildDefaultLogConfig();
      expect(config.globalLevel).toBe(LogLevel.INFO);
      expect(config.format).toBe('pretty'); // non-production default
      expect(config.includePayloads).toBe(true); // non-production default
      expect(config.includeStackTraces).toBe(true);
      expect(config.maxPayloadSizeBytes).toBe(8192);
      expect(config.categoryLevels).toEqual({});
      expect(config.endpointLevels).toEqual({});
    });

    it('should respect LOG_LEVEL env var', () => {
      process.env.LOG_LEVEL = 'TRACE';
      const config = buildDefaultLogConfig();
      expect(config.globalLevel).toBe(LogLevel.TRACE);
    });

    it('should use json format in production', () => {
      process.env.NODE_ENV = 'production';
      const config = buildDefaultLogConfig();
      expect(config.format).toBe('json');
    });

    it('should respect LOG_FORMAT env var in non-production', () => {
      process.env.LOG_FORMAT = 'json';
      const config = buildDefaultLogConfig();
      expect(config.format).toBe('json');
    });

    it('should disable payloads in production by default', () => {
      process.env.NODE_ENV = 'production';
      const config = buildDefaultLogConfig();
      expect(config.includePayloads).toBe(false);
    });

    it('should enable payloads in production when explicitly set', () => {
      process.env.NODE_ENV = 'production';
      process.env.LOG_INCLUDE_PAYLOADS = 'true';
      const config = buildDefaultLogConfig();
      expect(config.includePayloads).toBe(true);
    });

    it('should disable payloads in dev when explicitly set to false', () => {
      process.env.LOG_INCLUDE_PAYLOADS = 'false';
      const config = buildDefaultLogConfig();
      expect(config.includePayloads).toBe(false);
    });

    it('should disable stacks when LOG_INCLUDE_STACKS is false', () => {
      process.env.LOG_INCLUDE_STACKS = 'false';
      const config = buildDefaultLogConfig();
      expect(config.includeStackTraces).toBe(false);
    });

    it('should respect LOG_MAX_PAYLOAD_SIZE', () => {
      process.env.LOG_MAX_PAYLOAD_SIZE = '4096';
      const config = buildDefaultLogConfig();
      expect(config.maxPayloadSizeBytes).toBe(4096);
    });

    it('should parse LOG_CATEGORY_LEVELS', () => {
      process.env.LOG_CATEGORY_LEVELS = 'scim.patch=TRACE,auth=WARN,http=DEBUG';
      const config = buildDefaultLogConfig();
      expect(config.categoryLevels).toEqual({
        'scim.patch': LogLevel.TRACE,
        'auth': LogLevel.WARN,
        'http': LogLevel.DEBUG,
      });
    });

    it('should ignore invalid categories in LOG_CATEGORY_LEVELS', () => {
      process.env.LOG_CATEGORY_LEVELS = 'scim.patch=TRACE,invalid.category=DEBUG';
      const config = buildDefaultLogConfig();
      expect(config.categoryLevels).toEqual({
        'scim.patch': LogLevel.TRACE,
      });
    });

    it('should handle malformed LOG_CATEGORY_LEVELS gracefully', () => {
      process.env.LOG_CATEGORY_LEVELS = ',,,=,bad,,scim.user=INFO,';
      const config = buildDefaultLogConfig();
      expect(config.categoryLevels).toEqual({
        'scim.user': LogLevel.INFO,
      });
    });
  });
});
