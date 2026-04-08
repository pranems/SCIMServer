import * as path from 'node:path';
import { RotatingFileWriter } from './rotating-file-writer';
import type { StructuredLogEntry } from './scim-logger.service';

/**
 * FileLogTransport - writes structured log entries to rotating files.
 *
 * Manages two types of log files:
 * 1. Main log file (LOG_FILE env var, default: logs/scimserver.log)
 * 2. Per-endpoint log files (enabled per endpoint via logFileEnabled setting)
 *
 * File layout:
 *   logs/
 *     scimserver.log                           <- all traffic
 *     endpoints/
 *       contoso-prod_ep-a1b2c3d4/
 *         contoso-prod_ep-a1b2c3d4.log         <- endpoint-specific
 */
export class FileLogTransport {
  private mainWriter: RotatingFileWriter | null = null;
  private readonly endpointWriters = new Map<string, RotatingFileWriter>();
  private readonly endpointBaseDir: string;
  private readonly maxBytes: number;
  private readonly maxFiles: number;

  constructor(endpointBaseDirOverride?: string) {
    this.maxBytes = Number(process.env.LOG_FILE_MAX_SIZE) || 10_485_760; // 10MB
    this.maxFiles = Number(process.env.LOG_FILE_MAX_COUNT) || 3;

    const logFile = process.env.LOG_FILE;

    // Main file: LOG_FILE env var. Empty string = disabled.
    if (logFile !== undefined && logFile !== '') {
      const resolvedPath = path.resolve(logFile);
      this.mainWriter = new RotatingFileWriter(resolvedPath, this.maxBytes, this.maxFiles);
      this.endpointBaseDir = endpointBaseDirOverride ?? path.join(path.dirname(resolvedPath), 'endpoints');
    } else {
      // No main file, but endpoint files may still work
      this.endpointBaseDir = endpointBaseDirOverride ?? path.resolve('logs', 'endpoints');
    }
  }

  /** Write a structured log entry to main + endpoint file (if enabled). */
  write(entry: StructuredLogEntry): void {
    const line = JSON.stringify(entry);

    // Write to main file
    this.mainWriter?.writeLine(line);

    // Write to endpoint-specific file (if enabled for this endpointId)
    if (entry.endpointId) {
      const epWriter = this.endpointWriters.get(entry.endpointId);
      if (epWriter) {
        epWriter.writeLine(line);
      }
    }
  }

  /** Enable per-endpoint file logging. Creates writer lazily on first write. */
  enableEndpointFile(endpointId: string, endpointName: string): void {
    if (this.endpointWriters.has(endpointId)) return;

    const safeName = this.sanitizeName(endpointName);
    const id8 = endpointId.slice(0, 8);
    const dirName = `${safeName}_ep-${id8}`;
    const fileName = `${dirName}.log`;
    const filePath = path.join(this.endpointBaseDir, dirName, fileName);

    this.endpointWriters.set(endpointId, new RotatingFileWriter(filePath, this.maxBytes, this.maxFiles));
  }

  /** Disable per-endpoint file logging. Closes the file handle. */
  disableEndpointFile(endpointId: string): void {
    const writer = this.endpointWriters.get(endpointId);
    if (writer) {
      writer.close();
      this.endpointWriters.delete(endpointId);
    }
  }

  /** Close all file handles (main + all endpoint files). */
  close(): void {
    this.mainWriter?.close();
    this.mainWriter = null;

    for (const [id, writer] of this.endpointWriters) {
      writer.close();
    }
    this.endpointWriters.clear();
  }

  /** Sanitize endpoint name for filesystem safety. */
  private sanitizeName(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50) || 'unnamed';
  }
}
