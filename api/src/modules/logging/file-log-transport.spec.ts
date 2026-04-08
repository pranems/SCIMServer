import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { FileLogTransport } from './file-log-transport';
import type { StructuredLogEntry } from './scim-logger.service';

describe('FileLogTransport', () => {
  let tmpDir: string;
  let origLogFile: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flt-test-'));
    origLogFile = process.env.LOG_FILE;
  });

  afterEach(() => {
    if (origLogFile !== undefined) {
      process.env.LOG_FILE = origLogFile;
    } else {
      delete process.env.LOG_FILE;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeEntry(overrides: Partial<StructuredLogEntry> = {}): StructuredLogEntry {
    return {
      timestamp: '2026-04-08T12:00:00.000Z',
      level: 'INFO',
      category: 'scim.user',
      message: 'Test entry',
      requestId: 'req-001',
      ...overrides,
    };
  }

  // -- Main file --

  it('should write JSON lines to the main log file', () => {
    const mainFile = path.join(tmpDir, 'scimserver.log');
    process.env.LOG_FILE = mainFile;

    const transport = new FileLogTransport();
    transport.write(makeEntry({ message: 'hello' }));
    transport.close();

    const content = fs.readFileSync(mainFile, 'utf-8').trim();
    const parsed = JSON.parse(content);
    expect(parsed.message).toBe('hello');
    expect(parsed.level).toBe('INFO');
  });

  it('should not create main file when LOG_FILE is empty string', () => {
    process.env.LOG_FILE = '';

    const transport = new FileLogTransport();
    transport.write(makeEntry());
    transport.close();

    // No file should exist in tmpDir
    expect(fs.readdirSync(tmpDir)).toHaveLength(0);
  });

  // -- Endpoint files --

  it('should write to endpoint-specific log file when enabled', () => {
    process.env.LOG_FILE = path.join(tmpDir, 'main.log');

    const transport = new FileLogTransport();
    transport.enableEndpointFile('ep-123', 'contoso-prod');

    transport.write(makeEntry({ endpointId: 'ep-123', message: 'endpoint entry' }));
    transport.close();

    // Check endpoint file exists
    const epDir = path.join(tmpDir, 'endpoints', 'contoso-prod_ep-ep-123');
    const epFile = path.join(epDir, 'contoso-prod_ep-ep-123.log');
    expect(fs.existsSync(epFile)).toBe(true);

    const content = fs.readFileSync(epFile, 'utf-8').trim();
    const parsed = JSON.parse(content);
    expect(parsed.message).toBe('endpoint entry');
  });

  it('should NOT write to endpoint file when not enabled for that endpoint', () => {
    process.env.LOG_FILE = path.join(tmpDir, 'main.log');

    const transport = new FileLogTransport();
    // Enable for ep-123 but NOT ep-456
    transport.enableEndpointFile('ep-123', 'contoso');

    transport.write(makeEntry({ endpointId: 'ep-456', message: 'other endpoint' }));
    transport.close();

    // Main file should have it
    expect(fs.existsSync(path.join(tmpDir, 'main.log'))).toBe(true);
    // No endpoint dir for ep-456
    expect(fs.existsSync(path.join(tmpDir, 'endpoints', 'contoso_ep-ep-456'))).toBe(false);
  });

  it('should stop writing to endpoint file after disableEndpointFile', () => {
    process.env.LOG_FILE = path.join(tmpDir, 'main.log');

    const transport = new FileLogTransport();
    transport.enableEndpointFile('ep-123', 'test-ep');
    transport.write(makeEntry({ endpointId: 'ep-123', message: 'before disable' }));

    transport.disableEndpointFile('ep-123');
    transport.write(makeEntry({ endpointId: 'ep-123', message: 'after disable' }));
    transport.close();

    const epFile = path.join(tmpDir, 'endpoints', 'test-ep_ep-ep-123', 'test-ep_ep-ep-123.log');
    const content = fs.readFileSync(epFile, 'utf-8');
    expect(content).toContain('before disable');
    expect(content).not.toContain('after disable');
  });

  it('should work with endpoint files even when LOG_FILE is empty', () => {
    process.env.LOG_FILE = '';

    const transport = new FileLogTransport(path.join(tmpDir, 'endpoints'));
    transport.enableEndpointFile('ep-solo', 'solo-endpoint');
    transport.write(makeEntry({ endpointId: 'ep-solo', message: 'solo entry' }));
    transport.close();

    const epFile = path.join(tmpDir, 'endpoints', 'solo-endpoint_ep-ep-solo', 'solo-endpoint_ep-ep-solo.log');
    expect(fs.existsSync(epFile)).toBe(true);
  });

  // -- Name sanitization --

  it('should sanitize endpoint names for filesystem safety', () => {
    process.env.LOG_FILE = path.join(tmpDir, 'main.log');

    const transport = new FileLogTransport();
    transport.enableEndpointFile('ep-1', 'My Endpoint (Test) / Special!');
    transport.write(makeEntry({ endpointId: 'ep-1', message: 'sanitized' }));
    transport.close();

    // Check that directory was created with sanitized name
    const entries = fs.readdirSync(path.join(tmpDir, 'endpoints'));
    expect(entries.length).toBe(1);
    // Should not contain spaces, parens, slashes, or exclamation marks
    expect(entries[0]).not.toMatch(/[() /!]/);
    expect(entries[0]).toContain('ep-ep-1');
  });

  // -- Close --

  it('should close all file handles on close()', () => {
    process.env.LOG_FILE = path.join(tmpDir, 'main.log');

    const transport = new FileLogTransport();
    transport.enableEndpointFile('ep-1', 'test');
    transport.write(makeEntry({ endpointId: 'ep-1' }));

    // Should not throw
    transport.close();
    transport.close(); // double close should be safe
  });
});
