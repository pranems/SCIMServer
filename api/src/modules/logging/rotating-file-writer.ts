import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * RotatingFileWriter - size-based log file rotation.
 *
 * Writes JSON lines to a file and rotates when the file exceeds maxBytes.
 * Rotation scheme: app.log -> app.log.1 -> app.log.2 -> (deleted)
 *
 * No external dependencies - uses Node.js fs only.
 */
export class RotatingFileWriter {
  private fd: number | null = null;
  private currentSize = 0;
  private closed = false;

  constructor(
    private readonly filePath: string,
    private readonly maxBytes: number,
    private readonly maxFiles: number,
  ) {}

  /** Write a single line (appends newline). */
  writeLine(line: string): void {
    if (this.closed) return;

    if (this.fd === null) {
      this.openFile();
    }

    const data = line + '\n';
    fs.writeSync(this.fd!, data);
    this.currentSize += Buffer.byteLength(data);

    if (this.currentSize >= this.maxBytes) {
      this.rotate();
    }
  }

  /** Close the file handle. */
  close(): void {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
    this.closed = true;
  }

  /** Get the file path. */
  getFilePath(): string {
    return this.filePath;
  }

  private openFile(): void {
    // Create parent directories if needed
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });

    this.fd = fs.openSync(this.filePath, 'a');
    try {
      const stat = fs.fstatSync(this.fd);
      this.currentSize = stat.size;
    } catch {
      this.currentSize = 0;
    }
  }

  private rotate(): void {
    // Close current file
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }

    // Delete oldest rotated file if it exceeds maxFiles
    const oldest = `${this.filePath}.${this.maxFiles}`;
    if (fs.existsSync(oldest)) {
      fs.unlinkSync(oldest);
    }

    // Shift rotated files: .2 -> .3, .1 -> .2, etc.
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const src = `${this.filePath}.${i}`;
      const dst = `${this.filePath}.${i + 1}`;
      if (fs.existsSync(src)) {
        fs.renameSync(src, dst);
      }
    }

    // Rename current file to .1
    if (fs.existsSync(this.filePath)) {
      fs.renameSync(this.filePath, `${this.filePath}.1`);
    }

    // Open new file
    this.openFile();
  }
}
