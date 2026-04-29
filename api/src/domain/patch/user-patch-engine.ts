/**
 * User PATCH Engine (Phase 5)
 *
 * Pure domain class that applies SCIM PATCH operations to a user's in-memory state.
 * Zero NestJS / Prisma / DB dependencies - takes plain data in, returns plain data out.
 *
 * Responsibilities:
 *   - Operation dispatch (add / replace / remove)
 *   - Path handling: simple, valuePath, extension URN, dot-notation, no-path
 *   - First-class field extraction (userName, displayName, externalId, active)
 *   - Key normalization for case-insensitive attribute matching (RFC 7643 §2.1)
 *
 * The calling service handles: DB load, uniqueness checks, DB save, meta generation.
 *
 * @see RFC 7644 §3.5.2 - Modifying with PATCH
 */

import {
  isValuePath,
  parseValuePath,
  applyValuePathUpdate,
  addValuePathEntry,
  removeValuePathEntry,
  isExtensionPath,
  parseExtensionPath,
  applyExtensionUpdate,
  removeExtensionAttribute,
  resolveNoPathValue,
} from '../../modules/scim/utils/scim-patch-path';

import type {
  PatchOperation,
  PatchConfig,
  UserPatchResult,
  UserExtractedFields,
} from './patch-types';

import { PatchError } from './patch-error';

// ─── Input State ─────────────────────────────────────────────────────────────

/** Current user state provided by the service before PATCH application */
export interface UserPatchState {
  userName: string;
  displayName: string | null;
  externalId: string | null;
  active: boolean;
  rawPayload: Record<string, unknown>;
}

// ─── Canonical key map (RFC 7643 §2.1 case insensitivity) ───────────────────

const CANONICAL_KEY_MAP: Record<string, string> = {
  'username': 'userName',
  'externalid': 'externalId',
  'active': 'active',
  'displayname': 'displayName',
  'name': 'name',
  'nickname': 'nickName',
  'profileurl': 'profileUrl',
  'title': 'title',
  'usertype': 'userType',
  'preferredlanguage': 'preferredLanguage',
  'locale': 'locale',
  'timezone': 'timezone',
  'emails': 'emails',
  'phonenumbers': 'phoneNumbers',
  'addresses': 'addresses',
  'photos': 'photos',
  'ims': 'ims',
  'roles': 'roles',
  'entitlements': 'entitlements',
  'x509certificates': 'x509Certificates',
};

// ─── Reserved attributes (server-managed, never stored in rawPayload) ───────

const RESERVED_ATTRIBUTES = new Set([
  'id', 'username', 'userid', 'userName', 'externalid', 'externalId', 'active',
  'meta', 'schemas',
]);

// ─── Prototype pollution guard ──────────────────────────────────────────────

/** Keys that MUST be rejected to prevent prototype pollution attacks */
const DANGEROUS_KEYS = new Set([
  '__proto__', 'constructor', 'prototype',
]);

/** Throws PatchError if path contains a dangerous prototype-polluting key */
function guardPrototypePollution(path: string): void {
  const segments = path.split('.');
  for (const seg of segments) {
    if (DANGEROUS_KEYS.has(seg)) {
      throw new PatchError(
        400,
        `Attribute path '${path}' contains a forbidden key '${seg}'.`,
        'invalidPath',
      );
    }
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export class UserPatchEngine {
  /**
   * Apply an array of SCIM PATCH operations to the given user state.
   *
   * @param operations  - SCIM PatchOperation[] from the request DTO
   * @param state       - Current user values (from DB record)
   * @param config      - Endpoint configuration flags
   * @returns           - Updated payload + extracted first-class DB fields
   * @throws PatchError - On invalid op / path / value
   */
  static apply(
    operations: PatchOperation[],
    state: UserPatchState,
    config: PatchConfig,
  ): UserPatchResult {
    let { userName, displayName, externalId, active } = state;
    let rawPayload = { ...state.rawPayload };

    for (let i = 0; i < operations.length; i++) {
      const operation = operations[i];
      const op = operation.op?.toLowerCase();
      if (!op || !['add', 'replace', 'remove'].includes(op)) {
        throw new PatchError(
          400,
          `Patch operation '${operation.op}' is not supported.`,
          'invalidValue',
          { operationIndex: i, path: operation.path, op: operation.op },
        );
      }

      const originalPath = operation.path;
      const path = originalPath?.toLowerCase();

      try {
        if (op === 'add' || op === 'replace') {
          ({ userName, displayName, externalId, active, rawPayload } =
            UserPatchEngine.applyAddOrReplace(
              op, originalPath, path, operation.value,
              userName, displayName, externalId, active, rawPayload,
              config,
            ));
        } else {
          const removeResult = UserPatchEngine.applyRemove(
            originalPath, path, active, rawPayload, config,
          );
          active = removeResult.active;
          rawPayload = removeResult.rawPayload;
          if ('externalId' in removeResult) externalId = removeResult.externalId as string | null;
          if ('displayName' in removeResult) displayName = removeResult.displayName as string | null;
        }
      } catch (err) {
        if (err instanceof PatchError && err.operationIndex === undefined) {
          throw new PatchError(err.status, err.message, err.scimType, {
            operationIndex: i, path: operation.path, op: operation.op,
          });
        }
        throw err;
      }
    }

    rawPayload = UserPatchEngine.stripReservedAttributes(rawPayload);

    const extractedFields: UserExtractedFields = {
      userName,
      displayName,
      externalId,
      active,
    };

    return { payload: rawPayload, extractedFields };
  }

  // ─── Add / Replace ───────────────────────────────────────────────────

  private static applyAddOrReplace(
    op: string,
    originalPath: string | undefined,
    path: string | undefined,
    value: unknown,
    userName: string,
    displayName: string | null,
    externalId: string | null,
    active: boolean,
    rawPayload: Record<string, unknown>,
    config: PatchConfig,
  ) {
    if (path === 'active') {
      const val = UserPatchEngine.extractBooleanValue(value);
      return {
        userName, displayName, externalId,
        active: val,
        rawPayload: { ...rawPayload, active: val },
      };
    }

    if (path === 'username') {
      return {
        userName: UserPatchEngine.extractStringValue(value, 'userName'),
        displayName, externalId, active, rawPayload,
      };
    }

    if (path === 'displayname') {
      const val = UserPatchEngine.extractNullableStringValue(value, 'displayName');
      return {
        userName, externalId, active,
        displayName: val,
        rawPayload: { ...rawPayload, displayName: val },
      };
    }

    if (path === 'externalid') {
      return {
        userName, displayName, active, rawPayload,
        externalId: UserPatchEngine.extractNullableStringValue(value, 'externalId'),
      };
    }

    if (originalPath && isExtensionPath(originalPath, config.extensionUrns)) {
      const extParsed = parseExtensionPath(originalPath, config.extensionUrns);
      if (extParsed) {
        rawPayload = applyExtensionUpdate(rawPayload, extParsed, value);
      }
      return { userName, displayName, externalId, active, rawPayload };
    }

    if (originalPath && isValuePath(originalPath)) {
      const vpParsed = parseValuePath(originalPath);
      if (vpParsed) {
        // Resolve caseExact for the filter attribute from schema cache
        const filterPath = `${vpParsed.attribute.toLowerCase()}.${vpParsed.filterAttribute.toLowerCase()}`;
        const caseExact = config.caseExactPaths?.has(filterPath) ?? false;
        rawPayload = op === 'add'
          ? addValuePathEntry(rawPayload, vpParsed, value, caseExact)
          : applyValuePathUpdate(rawPayload, vpParsed, value, caseExact);
      }
      return { userName, displayName, externalId, active, rawPayload };
    }

    if (config.verbosePatch && originalPath && originalPath.includes('.')) {
      guardPrototypePollution(originalPath);
      rawPayload = UserPatchEngine.applyDotNotation(rawPayload, originalPath, value);
      return { userName, displayName, externalId, active, rawPayload };
    }

    if (originalPath) {
      guardPrototypePollution(originalPath);
      rawPayload = { ...rawPayload, [originalPath]: value };
      return { userName, displayName, externalId, active, rawPayload };
    }

    // No-path add/replace: object merged into resource
    if (!path && typeof value === 'object' && value !== null) {
      const updateObj = UserPatchEngine.normalizeObjectKeys(value as Record<string, unknown>);
      // Strip prototype-polluting keys from no-path merge
      for (const dk of DANGEROUS_KEYS) {
        delete updateObj[dk];
      }
      if ('userName' in updateObj) {
        userName = UserPatchEngine.extractStringValue(updateObj.userName, 'userName');
        delete updateObj.userName;
      }
      if ('displayName' in updateObj) {
        displayName = UserPatchEngine.extractNullableStringValue(updateObj.displayName, 'displayName');
        // Keep displayName in updateObj - must remain in rawPayload (response built from it)
      }
      if ('externalId' in updateObj) {
        externalId = UserPatchEngine.extractNullableStringValue(updateObj.externalId, 'externalId');
        delete updateObj.externalId;
      }
      if ('active' in updateObj) {
        active = UserPatchEngine.extractBooleanValue(updateObj.active);
        delete updateObj.active;
      }
      rawPayload = resolveNoPathValue(rawPayload, updateObj, config.extensionUrns);
      return { userName, displayName, externalId, active, rawPayload };
    }

    return { userName, displayName, externalId, active, rawPayload };
  }

  // ─── Remove ──────────────────────────────────────────────────────────

  private static applyRemove(
    originalPath: string | undefined,
    path: string | undefined,
    active: boolean,
    rawPayload: Record<string, unknown>,
    config: PatchConfig,
  ): { active: boolean; rawPayload: Record<string, unknown>; externalId?: null; displayName?: null } {
    if (path === 'active') {
      return { active: false, rawPayload: { ...rawPayload, active: false } };
    }

    // GAP-1: Column-promoted field remove handlers (RFC 7644 §3.5.2.2)
    if (path === 'username') {
      throw new PatchError(
        400,
        "Cannot remove required attribute 'userName'. userName is required for User resources (RFC 7643 §4.1).",
        'invalidValue',
      );
    }

    if (path === 'externalid') {
      return { active, rawPayload, externalId: null };
    }

    if (path === 'displayname') {
      rawPayload = UserPatchEngine.removeAttribute(rawPayload, originalPath ?? 'displayName');
      return { active, rawPayload, displayName: null };
    }

    if (originalPath && isExtensionPath(originalPath, config.extensionUrns)) {
      const extParsed = parseExtensionPath(originalPath, config.extensionUrns);
      if (extParsed) {
        rawPayload = removeExtensionAttribute(rawPayload, extParsed);
      }
      return { active, rawPayload };
    }

    if (originalPath && isValuePath(originalPath)) {
      const vpParsed = parseValuePath(originalPath);
      if (vpParsed) {
        const filterPath = `${vpParsed.attribute.toLowerCase()}.${vpParsed.filterAttribute.toLowerCase()}`;
        const caseExact = config.caseExactPaths?.has(filterPath) ?? false;
        rawPayload = removeValuePathEntry(rawPayload, vpParsed, caseExact);
      }
      return { active, rawPayload };
    }

    if (config.verbosePatch && originalPath && originalPath.includes('.')) {
      guardPrototypePollution(originalPath);
      rawPayload = UserPatchEngine.removeDotNotation(rawPayload, originalPath);
      return { active, rawPayload };
    }

    if (originalPath) {
      guardPrototypePollution(originalPath);
      rawPayload = UserPatchEngine.removeAttribute(rawPayload, originalPath);
      return { active, rawPayload };
    }

    throw new PatchError(400, 'Remove operation requires a path.', 'noTarget');
  }

  // ─── Dot-notation helpers ────────────────────────────────────────────

  private static applyDotNotation(
    rawPayload: Record<string, unknown>,
    originalPath: string,
    value: unknown,
  ): Record<string, unknown> {
    const dotIndex = originalPath.indexOf('.');
    const parentAttr = originalPath.substring(0, dotIndex);
    const childAttr = originalPath.substring(dotIndex + 1);
    const parentKey = Object.keys(rawPayload).find(
      k => k.toLowerCase() === parentAttr.toLowerCase(),
    ) ?? parentAttr;
    const existing = rawPayload[parentKey];
    if (typeof existing === 'object' && existing !== null && !Array.isArray(existing)) {
      (existing as Record<string, unknown>)[childAttr] = value;
    } else {
      rawPayload[parentKey] = { [childAttr]: value };
    }
    return rawPayload;
  }

  private static removeDotNotation(
    rawPayload: Record<string, unknown>,
    originalPath: string,
  ): Record<string, unknown> {
    const dotIndex = originalPath.indexOf('.');
    const parentAttr = originalPath.substring(0, dotIndex);
    const childAttr = originalPath.substring(dotIndex + 1);
    const parentKey = Object.keys(rawPayload).find(
      k => k.toLowerCase() === parentAttr.toLowerCase(),
    ) ?? parentAttr;
    const existing = rawPayload[parentKey];
    if (typeof existing === 'object' && existing !== null && !Array.isArray(existing)) {
      delete (existing as Record<string, unknown>)[childAttr];
    }
    return rawPayload;
  }

  // ─── Key normalization ───────────────────────────────────────────────

  /**
   * Normalize incoming JSON keys to canonical camelCase for known SCIM attributes.
   * Per RFC 7643 §2.1: "Attribute names are case insensitive".
   * Unknown keys are preserved as-is.
   */
  static normalizeObjectKeys(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const canonical = CANONICAL_KEY_MAP[key.toLowerCase()] ?? key;
      result[canonical] = value;
    }
    return result;
  }

  // ─── Value extraction helpers ────────────────────────────────────────

  static extractStringValue(value: unknown, attribute: string): string {
    if (typeof value === 'string') {
      return value;
    }
    throw new PatchError(
      400,
      `${attribute} must be provided as a string.`,
      'invalidValue',
    );
  }

  static extractNullableStringValue(value: unknown, attribute: string): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'string') {
      return value;
    }
    throw new PatchError(
      400,
      `${attribute} must be provided as a string or null.`,
      'invalidValue',
    );
  }

  static extractBooleanValue(value: unknown): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      const lower = value.toLowerCase();
      if (lower === 'true') return true;
      if (lower === 'false') return false;
    }
    if (typeof value === 'object' && value !== null && 'active' in value) {
      const active = (value as { active: unknown }).active;
      if (typeof active === 'boolean') return active;
      if (typeof active === 'string') {
        const lower = active.toLowerCase();
        if (lower === 'true') return true;
        if (lower === 'false') return false;
      }
    }
    throw new PatchError(
      400,
      `Patch operation requires boolean value for active. Received: ${typeof value} "${String(value)}"`,
      'invalidValue',
    );
  }

  // ─── Attribute management ────────────────────────────────────────────

  static stripReservedAttributes(payload: Record<string, unknown>): Record<string, unknown> {
    const entries = Object.entries(payload).filter(
      ([key]) => !RESERVED_ATTRIBUTES.has(key) && !RESERVED_ATTRIBUTES.has(key.toLowerCase()),
    );
    return Object.fromEntries(entries);
  }

  private static removeAttribute(payload: Record<string, unknown>, attribute: string): Record<string, unknown> {
    if (!attribute) return { ...payload };
    const target = attribute.toLowerCase();
    return Object.fromEntries(
      Object.entries(payload).filter(([key]) => key.toLowerCase() !== target),
    );
  }
}
