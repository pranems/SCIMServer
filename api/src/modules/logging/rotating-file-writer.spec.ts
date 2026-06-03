import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { RotatingFileWriter } from './rotating-file-writer';

describe('RotatingFileWriter', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfw-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should create the log file and parent directories on first write', () => {
    const filePath = path.join(tmpDir, 'sub', 'deep', 'app.log');
    const writer = new RotatingFileWriter(filePath, 1024, 3);

    writer.writeLine('hello world');
    writer.close();

    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toBe('hello world\n');
  });

  it('should append multiple lines', () => {
    const filePath = path.join(tmpDir, 'multi.log');
    const writer = new RotatingFileWriter(filePath, 1024, 3);

    writer.writeLine('line 1');
    writer.writeLine('line 2');
    writer.writeLine('line 3');
    writer.close();

    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
    expect(lines).toEqual(['line 1', 'line 2', 'line 3']);
  });

  it('should rotate when file exceeds maxBytes', () => {
    const filePath = path.join(tmpDir, 'rotate.log');
    // maxBytes = 50, each line is ~20 bytes -> rotate after ~3 lines
    const writer = new RotatingFileWriter(filePath, 50, 3);

    writer.writeLine('1234567890-abcdefgh'); // ~20 bytes
    writer.writeLine('1234567890-abcdefgh'); // ~20 bytes
    writer.writeLine('1234567890-abcdefgh'); // ~20 bytes - triggers rotation
    writer.writeLine('after-rotation-line');
    writer.close();

    // Current file should only have the post-rotation line
    const current = fs.readFileSync(filePath, 'utf-8');
    expect(current).toContain('after-rotation-line');

    // Rotated file should exist
    expect(fs.existsSync(`${filePath}.1`)).toBe(true);
  });

  it('should keep at most maxFiles rotated files', () => {
    const filePath = path.join(tmpDir, 'max.log');
    const writer = new RotatingFileWriter(filePath, 30, 2); // max 2 rotated files

    // Write enough to trigger multiple rotations
    for (let i = 0; i < 20; i++) {
      writer.writeLine(`line-${i}-padding-data`);
    }
    writer.close();

    // Should have: max.log (current), max.log.1, max.log.2
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.existsSync(`${filePath}.1`)).toBe(true);
    expect(fs.existsSync(`${filePath}.2`)).toBe(true);
    // max.log.3 should NOT exist (exceeds maxFiles=2)
    expect(fs.existsSync(`${filePath}.3`)).toBe(false);
  });

  it('should return the file path via getFilePath()', () => {
    const filePath = path.join(tmpDir, 'path-test.log');
    const writer = new RotatingFileWriter(filePath, 1024, 3);

    expect(writer.getFilePath()).toBe(filePath);
    writer.close();
  });

  it('should handle close gracefully when never written', () => {
    const filePath = path.join(tmpDir, 'never-written.log');
    const writer = new RotatingFileWriter(filePath, 1024, 3);

    // Should not throw
    writer.close();
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('should not write after close', () => {
    const filePath = path.join(tmpDir, 'after-close.log');
    const writer = new RotatingFileWriter(filePath, 1024, 3);

    writer.writeLine('before close');
    writer.close();
    writer.writeLine('after close'); // should be silently ignored

    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toBe('before close\n');
    expect(content).not.toContain('after close');
  });
});
