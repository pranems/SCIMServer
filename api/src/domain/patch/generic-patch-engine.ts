/**
 * GenericPatchEngine — Phase 8b Generic SCIM PATCH Engine
 *
 * Applies RFC 7644 §3.5.2 PATCH operations to a generic SCIM resource payload.
 *
 * This engine is intentionally simpler than the User/Group patch engines:
 *   - Operates directly on the JSONB payload object
 *   - Supports add, replace, remove operations
 *   - Supports dot-notation path resolution for nested attributes
 *   - Extension URN paths resolved via extensionUrns list (COLON separator)
 *   - No type-specific member management
 *   - No read-only pre-validation (custom types have no built-in schema constraints)
 *
 * @example
 *   const engine = new GenericPatchEngine(payload, ['urn:example:ext:2.0']);
 *   engine.apply({ op: 'replace', path: 'displayName', value: 'New Name' });
 *   engine.apply({ op: 'add', path: 'urn:example:ext:2.0:customAttr', value: 'hello' });
 *   const result = engine.getResult();
 */
import { PatchError } from './patch-error';
import {
  isExtensionPath,
  parseExtensionPath,
  applyExtensionUpdate,
  removeExtensionAttribute,
} from '../../modules/scim/utils/scim-patch-path';

interface PatchOperation {
  op: string;
  path?: string;
  value?: unknown;
}

export class GenericPatchEngine {
  private payload: Record<string, unknown>;
  private readonly extensionUrns: readonly string[];

  constructor(payload: Record<string, unknown>, extensionUrns?: readonly string[]) {
    // Deep clone to avoid mutating the original
    this.payload = JSON.parse(JSON.stringify(payload));
    this.extensionUrns = extensionUrns ?? [];
  }

  /**
   * Apply a single PATCH operation to the payload.
   *
   * @throws PatchError if the operation is invalid
   */
  apply(operation: PatchOperation): void {
    const op = operation.op?.toLowerCase();

    if (!op) {
      throw new PatchError(400, 'PATCH operation must have an "op" field.', 'invalidValue');
    }

    switch (op) {
      case 'add':
        this.applyAdd(operation);
        break;
      case 'replace':
        this.applyReplace(operation);
        break;
      case 'remove':
        this.applyRemove(operation);
        break;
      default:
        throw new PatchError(400, `Unsupported PATCH operation: "${op}".`, 'invalidValue');
    }
  }

  /** Get the resulting payload after all operations. */
  getResult(): Record<string, unknown> {
    return this.payload;
  }

  // ─── Operations ────────────────────────────────────────────────────────

  private applyAdd(op: PatchOperation): void {
    if (op.path) {
      this.setAtPath(op.path, op.value, /* merge */ true);
    } else {
      // No path → merge value into root (RFC 7644 §3.5.2.1)
      if (typeof op.value === 'object' && op.value !== null && !Array.isArray(op.value)) {
        for (const [key, val] of Object.entries(op.value)) {
          this.payload[key] = val;
        }
      } else {
        throw new PatchError(
          400,
          'PATCH add without path requires an object value.',
          'invalidValue',
        );
      }
    }
  }

  private applyReplace(op: PatchOperation): void {
    if (op.path) {
      this.setAtPath(op.path, op.value, /* merge */ false);
    } else {
      // No path → replace entire resource attributes (RFC 7644 §3.5.2.3)
      if (typeof op.value === 'object' && op.value !== null && !Array.isArray(op.value)) {
        for (const [key, val] of Object.entries(op.value)) {
          this.payload[key] = val;
        }
      } else {
        throw new PatchError(
          400,
          'PATCH replace without path requires an object value.',
          'invalidValue',
        );
      }
    }
  }

  private applyRemove(op: PatchOperation): void {
    if (!op.path) {
      throw new PatchError(400, 'PATCH remove requires a "path".', 'noTarget');
    }
    this.removeAtPath(op.path);
  }

  // ─── Path Resolution ──────────────────────────────────────────────────

  /**
   * Set a value at a dot-notation path (e.g., "name.givenName").
   * Creates intermediate objects as needed.
   *
   * Extension URN paths resolved via extensionUrns list first (COLON separator),
   * then falls back to legacy DOT-separated regex.
   */
  private setAtPath(path: string, value: unknown, merge: boolean): void {
    // Priority 1: Extension URN paths resolved via extensionUrns list (COLON separator)
    if (this.extensionUrns.length > 0 && isExtensionPath(path, this.extensionUrns)) {
      const parsed = parseExtensionPath(path, this.extensionUrns);
      if (parsed) {
        this.payload = applyExtensionUpdate(this.payload, parsed, value);
        return;
      }
    }

    // Priority 2: Legacy DOT-separated URN paths (backward compatibility)
    const urnMatch = path.match(/^(urn:[^.]+(?:\.\d+)*(?::[^.]+)*)\.(.+)$/);
    if (urnMatch) {
      const [, urn, subPath] = urnMatch;
      let ext = this.payload[urn] as Record<string, unknown> | undefined;
      if (!ext || typeof ext !== 'object') {
        ext = {};
        this.payload[urn] = ext;
      }
      this.setNested(ext, subPath.split('.'), value, merge);
      return;
    }

    const segments = path.split('.');
    if (segments.length === 1) {
      if (merge && Array.isArray(this.payload[path]) && Array.isArray(value)) {
        (this.payload[path] as unknown[]).push(...(value as unknown[]));
      } else {
        this.payload[path] = value;
      }
    } else {
      this.setNested(this.payload, segments, value, merge);
    }
  }

  private setNested(
    obj: Record<string, unknown>,
    segments: string[],
    value: unknown,
    merge: boolean,
  ): void {
    let current = obj;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      if (typeof current[seg] !== 'object' || current[seg] === null) {
        current[seg] = {};
      }
      current = current[seg] as Record<string, unknown>;
    }
    const last = segments[segments.length - 1];
    if (merge && Array.isArray(current[last]) && Array.isArray(value)) {
      (current[last] as unknown[]).push(...(value as unknown[]));
    } else {
      current[last] = value;
    }
  }

  /**
   * Remove a value at a dot-notation path.
   *
   * Extension URN paths resolved via extensionUrns list first (COLON separator),
   * then falls back to legacy DOT-separated regex.
   */
  private removeAtPath(path: string): void {
    // Priority 1: Extension URN paths resolved via extensionUrns list (COLON separator)
    if (this.extensionUrns.length > 0 && isExtensionPath(path, this.extensionUrns)) {
      const parsed = parseExtensionPath(path, this.extensionUrns);
      if (parsed) {
        this.payload = removeExtensionAttribute(this.payload, parsed);
        return;
      }
    }

    // Priority 2: Legacy DOT-separated URN paths (backward compatibility)
    const urnMatch = path.match(/^(urn:[^.]+(?:\.\d+)*(?::[^.]+)*)\.(.+)$/);
    if (urnMatch) {
      const [, urn, subPath] = urnMatch;
      const ext = this.payload[urn] as Record<string, unknown> | undefined;
      if (ext && typeof ext === 'object') {
        this.removeNested(ext, subPath.split('.'));
      }
      return;
    }

    const segments = path.split('.');
    if (segments.length === 1) {
      delete this.payload[path];
    } else {
      this.removeNested(this.payload, segments);
    }
  }

  private removeNested(obj: Record<string, unknown>, segments: string[]): void {
    let current = obj;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      if (typeof current[seg] !== 'object' || current[seg] === null) {
        return; // Path doesn't exist — no-op
      }
      current = current[seg] as Record<string, unknown>;
    }
    delete current[segments[segments.length - 1]];
  }
}
