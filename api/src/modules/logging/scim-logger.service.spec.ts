import { ScimLogger, CorrelationContext, StructuredLogEntry } from './scim-logger.service';
import { LogLevel, LogCategory, LogConfig } from './log-levels';

describe('ScimLogger', () => {
  let logger: ScimLogger;

  // Capture console output
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;
  let consoleLogSpy: jest.SpyInstance;
  let consoleDebugSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    // Set env to avoid production defaults
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'TRACE';
    process.env.LOG_FORMAT = 'json';
    process.env.LOG_INCLUDE_PAYLOADS = 'true';
    process.env.LOG_INCLUDE_STACKS = 'true';

    logger = new ScimLogger();

    // Spy on output to suppress and capture
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleDebugSpy = jest.spyOn(console, 'debug').mockImplementation();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleDebugSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  // ─── Construction ─────────────────────────────────────────────────

  describe('construction', () => {
    it('should be instantiable', () => {
      expect(logger).toBeDefined();
    });

    it('should build default config from env vars', () => {
      const config = logger.getConfig();
      expect(config.globalLevel).toBe(LogLevel.TRACE);
      expect(config.format).toBe('json');
    });
  });

  // ─── Configuration ────────────────────────────────────────────────

  describe('configuration', () => {
    it('getConfig should return a copy of config', () => {
      const config1 = logger.getConfig();
      const config2 = logger.getConfig();
      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2); // different object references
    });

    it('updateConfig should merge partial updates', () => {
      logger.updateConfig({ globalLevel: LogLevel.WARN });
      expect(logger.getConfig().globalLevel).toBe(LogLevel.WARN);
      // Other fields remain unchanged
      expect(logger.getConfig().format).toBe('json');
    });

    it('setGlobalLevel should accept string', () => {
      logger.setGlobalLevel('ERROR');
      expect(logger.getConfig().globalLevel).toBe(LogLevel.ERROR);
    });

    it('setGlobalLevel should accept LogLevel enum', () => {
      logger.setGlobalLevel(LogLevel.DEBUG);
      expect(logger.getConfig().globalLevel).toBe(LogLevel.DEBUG);
    });

    it('setCategoryLevel should set a category override', () => {
      logger.setCategoryLevel(LogCategory.SCIM_PATCH, 'TRACE');
      expect(logger.getConfig().categoryLevels[LogCategory.SCIM_PATCH]).toBe(LogLevel.TRACE);
    });

    it('setEndpointLevel should set an endpoint override', () => {
      logger.setEndpointLevel('ep-123', 'DEBUG');
      expect(logger.getConfig().endpointLevels['ep-123']).toBe(LogLevel.DEBUG);
    });

    it('clearEndpointLevel should remove an endpoint override', () => {
      logger.setEndpointLevel('ep-123', 'DEBUG');
      logger.clearEndpointLevel('ep-123');
      expect(logger.getConfig().endpointLevels['ep-123']).toBeUndefined();
    });

    it('setConfig should replace entire config', () => {
      const newConfig: LogConfig = {
        globalLevel: LogLevel.OFF,
        categoryLevels: {},
        endpointLevels: {},
        includePayloads: false,
        includeStackTraces: false,
        maxPayloadSizeBytes: 1024,
        format: 'pretty',
      };
      logger.setConfig(newConfig);
      const config = logger.getConfig();
      expect(config.globalLevel).toBe(LogLevel.OFF);
      expect(config.format).toBe('pretty');
      expect(config.maxPayloadSizeBytes).toBe(1024);
    });
  });

  // ─── Correlation Context ──────────────────────────────────────────

  describe('correlation context', () => {
    it('getContext should return undefined outside of runWithContext', () => {
      expect(logger.getContext()).toBeUndefined();
    });

    it('runWithContext should provide context inside the callback', () => {
      const ctx: CorrelationContext = {
        requestId: 'test-req-001',
        method: 'GET',
        path: '/test',
      };

      logger.runWithContext(ctx, () => {
        const currentCtx = logger.getContext();
        expect(currentCtx).toBeDefined();
        expect(currentCtx!.requestId).toBe('test-req-001');
        expect(currentCtx!.method).toBe('GET');
        expect(currentCtx!.path).toBe('/test');
      });
    });

    it('context should not leak outside of runWithContext', () => {
      const ctx: CorrelationContext = { requestId: 'test-req-002' };
      logger.runWithContext(ctx, () => {
        expect(logger.getContext()).toBeDefined();
      });
      expect(logger.getContext()).toBeUndefined();
    });

    it('enrichContext should update fields on the current context', () => {
      const ctx: CorrelationContext = { requestId: 'test-req-003' };
      logger.runWithContext(ctx, () => {
        logger.enrichContext({ endpointId: 'ep-456', authType: 'oauth' });
        const currentCtx = logger.getContext();
        expect(currentCtx!.endpointId).toBe('ep-456');
        expect(currentCtx!.authType).toBe('oauth');
        expect(currentCtx!.requestId).toBe('test-req-003');
      });
    });

    it('enrichContext should be a no-op outside of context', () => {
      // Should not throw
      logger.enrichContext({ endpointId: 'ep-nope' });
      expect(logger.getContext()).toBeUndefined();
    });

    it('runWithContext should return the callback result', () => {
      const ctx: CorrelationContext = { requestId: 'test-req-004' };
      const result = logger.runWithContext(ctx, () => 42);
      expect(result).toBe(42);
    });
  });

  // ─── Level Filtering (isEnabled) ──────────────────────────────────

  describe('isEnabled', () => {
    it('should allow messages at or above global level', () => {
      logger.setGlobalLevel(LogLevel.INFO);
      expect(logger.isEnabled(LogLevel.INFO)).toBe(true);
      expect(logger.isEnabled(LogLevel.WARN)).toBe(true);
      expect(logger.isEnabled(LogLevel.ERROR)).toBe(true);
      expect(logger.isEnabled(LogLevel.DEBUG)).toBe(false);
      expect(logger.isEnabled(LogLevel.TRACE)).toBe(false);
    });

    it('should use category override over global level', () => {
      logger.setGlobalLevel(LogLevel.INFO);
      logger.setCategoryLevel(LogCategory.SCIM_PATCH, LogLevel.TRACE);

      expect(logger.isEnabled(LogLevel.TRACE, LogCategory.SCIM_PATCH)).toBe(true);
      expect(logger.isEnabled(LogLevel.TRACE, LogCategory.HTTP)).toBe(false); // no category override, uses global
    });

    it('should use endpoint override over category and global', () => {
      logger.setGlobalLevel(LogLevel.INFO);
      logger.setCategoryLevel(LogCategory.HTTP, LogLevel.TRACE);
      logger.setEndpointLevel('ep-debug', LogLevel.WARN);

      // Inside endpoint context
      const ctx: CorrelationContext = { requestId: 'req-1', endpointId: 'ep-debug' };
      logger.runWithContext(ctx, () => {
        // Endpoint override (WARN) takes precedence
        expect(logger.isEnabled(LogLevel.TRACE, LogCategory.HTTP)).toBe(false);
        expect(logger.isEnabled(LogLevel.WARN, LogCategory.HTTP)).toBe(true);
        expect(logger.isEnabled(LogLevel.DEBUG, LogCategory.HTTP)).toBe(false);
      });
    });

    it('OFF level should suppress all messages', () => {
      logger.setGlobalLevel(LogLevel.OFF);
      expect(logger.isEnabled(LogLevel.FATAL)).toBe(false);
    });

    it('TRACE level should allow everything', () => {
      logger.setGlobalLevel(LogLevel.TRACE);
      expect(logger.isEnabled(LogLevel.TRACE)).toBe(true);
    });
  });

  // ─── Logging Methods ──────────────────────────────────────────────

  describe('logging methods', () => {
    beforeEach(() => {
      logger.setGlobalLevel(LogLevel.TRACE);
      logger.updateConfig({ format: 'json' });
    });

    it('trace() should emit at TRACE level', () => {
      logger.trace(LogCategory.HTTP, 'trace message');
      expect(stdoutSpy).toHaveBeenCalled();
      const output = stdoutSpy.mock.calls[0][0];
      const entry = JSON.parse(output) as StructuredLogEntry;
      expect(entry.level).toBe('TRACE');
      expect(entry.category).toBe('http');
      expect(entry.message).toBe('trace message');
    });

    it('debug() should emit at DEBUG level', () => {
      logger.debug(LogCategory.AUTH, 'debug message');
      expect(stdoutSpy).toHaveBeenCalled();
      const entry = JSON.parse(stdoutSpy.mock.calls[0][0]) as StructuredLogEntry;
      expect(entry.level).toBe('DEBUG');
      expect(entry.category).toBe('auth');
    });

    it('info() should emit at INFO level', () => {
      logger.info(LogCategory.SCIM_USER, 'User created', { userId: 'u1' });
      expect(stdoutSpy).toHaveBeenCalled();
      const entry = JSON.parse(stdoutSpy.mock.calls[0][0]) as StructuredLogEntry;
      expect(entry.level).toBe('INFO');
      expect(entry.message).toBe('User created');
      expect(entry.data).toEqual({ userId: 'u1' });
    });

    it('warn() should emit to stderr', () => {
      logger.warn(LogCategory.HTTP, 'Slow request');
      expect(stderrSpy).toHaveBeenCalled();
      const entry = JSON.parse(stderrSpy.mock.calls[0][0]) as StructuredLogEntry;
      expect(entry.level).toBe('WARN');
    });

    it('error() should emit to stderr with error info', () => {
      const err = new Error('test error');
      logger.error(LogCategory.DATABASE, 'DB failed', err);
      expect(stderrSpy).toHaveBeenCalled();
      const entry = JSON.parse(stderrSpy.mock.calls[0][0]) as StructuredLogEntry;
      expect(entry.level).toBe('ERROR');
      expect(entry.error).toBeDefined();
      expect(entry.error!.message).toBe('test error');
      expect(entry.error!.name).toBe('Error');
    });

    it('fatal() should emit to stderr with error info', () => {
      logger.fatal(LogCategory.GENERAL, 'Fatal issue', new Error('critical'));
      expect(stderrSpy).toHaveBeenCalled();
      const entry = JSON.parse(stderrSpy.mock.calls[0][0]) as StructuredLogEntry;
      expect(entry.level).toBe('FATAL');
      expect(entry.error!.message).toBe('critical');
    });

    it('should not emit when level is suppressed', () => {
      logger.setGlobalLevel(LogLevel.ERROR);
      logger.info(LogCategory.HTTP, 'Should not appear');
      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('should include correlation context in entries', () => {
      const ctx: CorrelationContext = {
        requestId: 'ctx-req-001',
        method: 'POST',
        path: '/scim/Users',
        endpointId: 'ep-test',
        startTime: Date.now() - 50,
      };

      logger.runWithContext(ctx, () => {
        logger.info(LogCategory.SCIM_USER, 'User created');
      });

      const entry = JSON.parse(stdoutSpy.mock.calls[0][0]) as StructuredLogEntry;
      expect(entry.requestId).toBe('ctx-req-001');
      expect(entry.method).toBe('POST');
      expect(entry.path).toBe('/scim/Users');
      expect(entry.endpointId).toBe('ep-test');
      expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle non-Error objects in error()', () => {
      logger.error(LogCategory.GENERAL, 'Something failed', 'string error');
      const entry = JSON.parse(stderrSpy.mock.calls[0][0]) as StructuredLogEntry;
      expect(entry.error!.message).toBe('string error');
    });

    it('should handle null error in error()', () => {
      logger.error(LogCategory.GENERAL, 'Null error', null);
      const entry = JSON.parse(stderrSpy.mock.calls[0][0]) as StructuredLogEntry;
      expect(entry.error).toBeUndefined();
    });

    it('should include additional data with error()', () => {
      logger.error(LogCategory.HTTP, 'Request failed', new Error('fail'), { status: 500 });
      const entry = JSON.parse(stderrSpy.mock.calls[0][0]) as StructuredLogEntry;
      expect(entry.error!.message).toBe('fail');
      expect(entry.data).toEqual({ status: 500 });
    });
  });

  // ─── Sanitization ─────────────────────────────────────────────────

  describe('sanitization', () => {
    beforeEach(() => {
      logger.setGlobalLevel(LogLevel.TRACE);
      logger.updateConfig({ format: 'json', maxPayloadSizeBytes: 100 });
    });

    it('should redact sensitive fields', () => {
      logger.info(LogCategory.AUTH, 'Auth check', {
        clientId: 'my-client',
        secret: 'super-secret-value',
        password: 'p@ssw0rd',
        token: 'jwt.token.here',
        authorization: 'Bearer xyz',
      });

      const entry = JSON.parse(stdoutSpy.mock.calls[0][0]) as StructuredLogEntry;
      expect(entry.data!.clientId).toBe('my-client');
      expect(entry.data!.secret).toBe('[REDACTED]');
      expect(entry.data!.password).toBe('[REDACTED]');
      expect(entry.data!.token).toBe('[REDACTED]');
      expect(entry.data!.authorization).toBe('[REDACTED]');
    });

    it('should truncate large string values', () => {
      const longString = 'x'.repeat(200);
      logger.info(LogCategory.HTTP, 'Large body', { body: longString });

      const entry = JSON.parse(stdoutSpy.mock.calls[0][0]) as StructuredLogEntry;
      const bodyValue = entry.data!.body as string;
      expect(bodyValue.length).toBeLessThan(200);
      expect(bodyValue).toContain('...[truncated');
    });

    it('should truncate large object values', () => {
      const bigObject: Record<string, string> = {};
      for (let i = 0; i < 20; i++) {
        bigObject[`field${i}`] = 'x'.repeat(20);
      }
      logger.info(LogCategory.HTTP, 'Large object', { data: bigObject });

      const entry = JSON.parse(stdoutSpy.mock.calls[0][0]) as StructuredLogEntry;
      const dataValue = entry.data!.data as string;
      expect(typeof dataValue).toBe('string');
      expect(dataValue).toContain('...[truncated]');
    });

    it('should pass through small values unchanged', () => {
      logger.info(LogCategory.HTTP, 'Small data', { name: 'Alice', age: 30 });
      const entry = JSON.parse(stdoutSpy.mock.calls[0][0]) as StructuredLogEntry;
      expect(entry.data).toEqual({ name: 'Alice', age: 30 });
    });
  });

  // ─── Stack Traces ─────────────────────────────────────────────────

  describe('stack traces', () => {
    it('should include stack traces when includeStackTraces is true', () => {
      logger.updateConfig({ format: 'json', includeStackTraces: true });
      logger.error(LogCategory.DATABASE, 'DB error', new Error('test'));
      const entry = JSON.parse(stderrSpy.mock.calls[0][0]) as StructuredLogEntry;
      expect(entry.error!.stack).toBeDefined();
      expect(entry.error!.stack).toContain('Error: test');
    });

    it('should strip stack traces when includeStackTraces is false', () => {
      logger.updateConfig({ format: 'json', includeStackTraces: false });
      logger.error(LogCategory.DATABASE, 'DB error', new Error('test'));
      const entry = JSON.parse(stderrSpy.mock.calls[0][0]) as StructuredLogEntry;
      expect(entry.error!.stack).toBeUndefined();
    });
  });

  // ─── Ring Buffer ──────────────────────────────────────────────────

  describe('ring buffer', () => {
    beforeEach(() => {
      logger.setGlobalLevel(LogLevel.TRACE);
      logger.updateConfig({ format: 'json' });
      logger.clearRecentLogs();
    });

    it('should store log entries in the ring buffer', () => {
      logger.info(LogCategory.HTTP, 'entry 1');
      logger.warn(LogCategory.AUTH, 'entry 2');

      const logs = logger.getRecentLogs();
      expect(logs).toHaveLength(2);
      expect(logs[0].message).toBe('entry 1');
      expect(logs[1].message).toBe('entry 2');
    });

    it('should respect limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        logger.info(LogCategory.HTTP, `entry ${i}`);
      }

      const logs = logger.getRecentLogs({ limit: 3 });
      expect(logs).toHaveLength(3);
      // Should return the LAST 3 entries
      expect(logs[0].message).toBe('entry 7');
      expect(logs[2].message).toBe('entry 9');
    });

    it('should filter by level', () => {
      logger.info(LogCategory.HTTP, 'info entry');
      logger.warn(LogCategory.HTTP, 'warn entry');
      logger.error(LogCategory.HTTP, 'error entry', new Error('test'));

      const logs = logger.getRecentLogs({ level: LogLevel.WARN });
      expect(logs).toHaveLength(2);
      expect(logs[0].level).toBe('WARN');
      expect(logs[1].level).toBe('ERROR');
    });

    it('should filter by category', () => {
      logger.info(LogCategory.HTTP, 'http entry');
      logger.info(LogCategory.AUTH, 'auth entry');
      logger.info(LogCategory.SCIM_USER, 'user entry');

      const logs = logger.getRecentLogs({ category: LogCategory.AUTH });
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('auth entry');
    });

    it('should filter by requestId', () => {
      const ctx1: CorrelationContext = { requestId: 'req-aaa' };
      const ctx2: CorrelationContext = { requestId: 'req-bbb' };

      logger.runWithContext(ctx1, () => {
        logger.info(LogCategory.HTTP, 'request A');
      });
      logger.runWithContext(ctx2, () => {
        logger.info(LogCategory.HTTP, 'request B');
      });

      const logs = logger.getRecentLogs({ requestId: 'req-aaa' });
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('request A');
    });

    it('should filter by endpointId', () => {
      const ctx1: CorrelationContext = { requestId: 'r1', endpointId: 'ep-111' };
      const ctx2: CorrelationContext = { requestId: 'r2', endpointId: 'ep-222' };

      logger.runWithContext(ctx1, () => {
        logger.info(LogCategory.HTTP, 'endpoint 1');
      });
      logger.runWithContext(ctx2, () => {
        logger.info(LogCategory.HTTP, 'endpoint 2');
      });

      const logs = logger.getRecentLogs({ endpointId: 'ep-222' });
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('endpoint 2');
    });

    it('should clear ring buffer', () => {
      logger.info(LogCategory.HTTP, 'entry');
      expect(logger.getRecentLogs()).toHaveLength(1);

      logger.clearRecentLogs();
      expect(logger.getRecentLogs()).toHaveLength(0);
    });

    it('should evict oldest entries when buffer is full', () => {
      // The maxRingBufferSize is 500, let's push 510 entries
      for (let i = 0; i < 510; i++) {
        logger.info(LogCategory.HTTP, `entry ${i}`);
      }

      const logs = logger.getRecentLogs({ limit: 510 });
      // Should have at most 500 entries
      expect(logs.length).toBeLessThanOrEqual(500);
      // First entry should be entry 10 (0-9 evicted)
      expect(logs[0].message).toBe('entry 10');
    });

    it('should combine multiple filters', () => {
      const ctx: CorrelationContext = { requestId: 'multi-req', endpointId: 'ep-multi' };

      logger.runWithContext(ctx, () => {
        logger.info(LogCategory.HTTP, 'info http');
        logger.warn(LogCategory.HTTP, 'warn http');
        logger.info(LogCategory.AUTH, 'info auth');
        logger.warn(LogCategory.AUTH, 'warn auth');
      });

      const logs = logger.getRecentLogs({
        level: LogLevel.WARN,
        category: LogCategory.HTTP,
        requestId: 'multi-req',
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('warn http');
    });
  });

  // ─── Pretty Output ────────────────────────────────────────────────

  describe('pretty output', () => {
    beforeEach(() => {
      logger.setGlobalLevel(LogLevel.TRACE);
      logger.updateConfig({ format: 'pretty' });
    });

    it('should emit info using console.log', () => {
      logger.info(LogCategory.HTTP, 'test message');
      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0] as string;
      expect(output).toContain('INFO');
      expect(output).toContain('http');
      expect(output).toContain('test message');
    });

    it('should emit debug using console.debug', () => {
      logger.debug(LogCategory.AUTH, 'debug msg');
      expect(consoleDebugSpy).toHaveBeenCalled();
    });

    it('should emit warn using console.warn', () => {
      logger.warn(LogCategory.HTTP, 'warning');
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('should emit error using console.error', () => {
      logger.error(LogCategory.DATABASE, 'error', new Error('e'));
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  // ─── JSON Output ──────────────────────────────────────────────────

  describe('json output', () => {
    beforeEach(() => {
      logger.setGlobalLevel(LogLevel.TRACE);
      logger.updateConfig({ format: 'json' });
    });

    it('should produce valid JSON on stdout for TRACE', () => {
      logger.trace(LogCategory.HTTP, 'json trace');
      expect(stdoutSpy).toHaveBeenCalled();
      const output = stdoutSpy.mock.calls[0][0] as string;
      expect(output.endsWith('\n')).toBe(true);
      const parsed = JSON.parse(output);
      expect(parsed.level).toBe('TRACE');
    });

    it('should produce valid JSON on stderr for ERROR', () => {
      logger.error(LogCategory.HTTP, 'json error', new Error('x'));
      expect(stderrSpy).toHaveBeenCalled();
      const output = stderrSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.level).toBe('ERROR');
    });

    it('should include ISO-8601 timestamp', () => {
      logger.info(LogCategory.HTTP, 'timestamp test');
      const entry = JSON.parse(stdoutSpy.mock.calls[0][0]) as StructuredLogEntry;
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  // ─── Live Stream (subscribe) ──────────────────────────────────────

  describe('subscribe', () => {
    it('should notify subscribers when a log is emitted', () => {
      const received: StructuredLogEntry[] = [];
      const unsub = logger.subscribe(entry => received.push(entry));

      logger.info(LogCategory.HTTP, 'test entry');

      expect(received).toHaveLength(1);
      expect(received[0].message).toBe('test entry');
      expect(received[0].level).toBe('INFO');

      unsub();
    });

    it('should stop notifying after unsubscribe', () => {
      const received: StructuredLogEntry[] = [];
      const unsub = logger.subscribe(entry => received.push(entry));

      logger.info(LogCategory.HTTP, 'before unsub');
      unsub();
      logger.info(LogCategory.HTTP, 'after unsub');

      expect(received).toHaveLength(1);
      expect(received[0].message).toBe('before unsub');
    });

    it('should support multiple subscribers', () => {
      const received1: StructuredLogEntry[] = [];
      const received2: StructuredLogEntry[] = [];
      const unsub1 = logger.subscribe(entry => received1.push(entry));
      const unsub2 = logger.subscribe(entry => received2.push(entry));

      logger.info(LogCategory.HTTP, 'multi');

      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(1);

      unsub1();
      unsub2();
    });

    it('should only deliver entries at enabled log levels', () => {
      logger.setGlobalLevel(LogLevel.WARN);
      const received: StructuredLogEntry[] = [];
      const unsub = logger.subscribe(entry => received.push(entry));

      logger.debug(LogCategory.HTTP, 'filtered out');
      logger.warn(LogCategory.HTTP, 'should arrive');

      expect(received).toHaveLength(1);
      expect(received[0].level).toBe('WARN');

      unsub();
    });
  });
});
