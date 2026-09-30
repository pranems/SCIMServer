import { PatchExecutor } from './patch-executor';
import { PatchError } from './patch-error';
import { parsePatchTarget } from './patch-path';
import type { PatchOperation, PatchConfig, UserPatchResult } from './patch-types';
import { objectValue } from './patch-values';
import { KNOWN_EXTENSION_URNS } from '../../modules/scim/common/scim-constants';
import { withResolvedProperty as put, withoutResolvedProperty as omit } from '../../modules/scim/utils/scim-patch-path';

export interface UserPatchState {
  userName: string;
  displayName: string | null;
  externalId: string | null;
  active: boolean;
  rawPayload: Record<string, unknown>;
}
const names = ['userName', 'externalId', 'active', 'displayName', 'name', 'nickName', 'profileUrl',
  'title', 'userType', 'preferredLanguage', 'locale', 'timezone', 'emails', 'phoneNumbers',
  'addresses', 'photos', 'ims', 'roles', 'entitlements', 'x509Certificates'];
const reserved = new Set(['id', 'username', 'userid', 'externalid', 'active', 'meta', 'schemas']);

/** User column and active compatibility adapter over shared attribute execution. */
export class UserPatchEngine {
  static apply(operations: PatchOperation[], state: UserPatchState, config: PatchConfig): UserPatchResult {
    const executor = new PatchExecutor({
      ...state.rawPayload, userName: state.userName, displayName: state.displayName,
      externalId: state.externalId, active: state.active,
    }, {
      ...config, extensionUrns: config.extensionUrns ?? KNOWN_EXTENSION_URNS,
      literalUnregisteredUrns: true, synthesizeCoreEqualityAdd: true,
    }, {
      normalizeOperation: operation => {
        // The legacy no-path object form remains supported regardless of this
        // explicit-path capability. Disabled paths must never become stored keys.
        if (operation.path && !config.verbosePatch) {
          const parsed = parsePatchTarget(operation.path, config.extensionUrns ?? KNOWN_EXTENSION_URNS);
          if (parsed.kind === 'attribute' && !parsed.schemaUrn && parsed.subAttribute) {
            throw new PatchError(400, 'Explicit core sub-attribute PATCH paths require VerbosePatchSupported.', 'invalidPath');
          }
        }
        return !operation.path && objectValue(operation.value)
        ? { ...operation, value: this.normalizeObjectKeys(Object.fromEntries(
          Object.entries(operation.value).filter(([key]) => !['id', 'meta', 'schemas'].includes(key.toLowerCase())),
        )) } : operation;
      },
      normalizeValue: (path, value, op) => op !== 'remove' && path.schemaUrn && path.kind !== 'selection' &&
        !path.subAttribute && path.attribute.toLowerCase() === 'manager' && typeof value === 'string' && value !== ''
        ? { value } : value,
      mutate: (payload, path, operation) => {
        if (path.schemaUrn || path.subAttribute || path.kind === 'selection') return undefined;
        const key = path.attribute.toLowerCase();
        const remove = operation.op === 'remove';
        if (key === 'username') {
          if (remove) throw new PatchError(400, "Cannot remove required attribute 'userName'.", 'invalidValue');
          return put(payload, 'userName', this.extractStringValue(operation.value, 'userName'));
        }
        if (key === 'active') return put(payload, 'active', remove ? false
          : this.extractBooleanValue(operation.value, config.allowAndCoerceBooleanStrings ?? true));
        if (key === 'displayname' || key === 'externalid') {
          const canonical = key === 'displayname' ? 'displayName' : 'externalId';
          return remove ? omit(payload, canonical) : put(payload, canonical, this.extractNullableStringValue(operation.value, canonical));
        }
        return undefined;
      },
    });
    operations.forEach(op => executor.apply(op));
    const payload = executor.getResult();
    const extractedFields = {
      userName: payload.userName as string, displayName: payload.displayName as string | null ?? null,
      externalId: payload.externalId as string | null ?? null, active: payload.active as boolean,
    };
    const displayTouched = operations.some(op => op.path
      ? /^(?:urn:ietf:params:scim:schemas:core:2.0:User:)?displayName$/i.test(op.path)
      : objectValue(op.value) && Object.keys(op.value).some(key => key.toLowerCase() === 'displayname'));
    if (!displayTouched) {
      delete payload.displayName;
      for (const [key, value] of Object.entries(state.rawPayload)) {
        if (key.toLowerCase() === 'displayname') payload[key] = value;
      }
    }
    return { payload: this.stripReservedAttributes(payload), extractedFields };
  }

  static normalizeObjectKeys(obj: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(obj).map(([key, value]) => [
      names.find(name => name.toLowerCase() === key.toLowerCase()) ?? key, value,
    ]));
  }
  static extractStringValue(value: unknown, attribute: string): string {
    if (typeof value === 'string') return value;
    throw new PatchError(400, `${attribute} must be provided as a string.`, 'invalidValue');
  }
  static extractNullableStringValue(value: unknown, attribute: string): string | null {
    return value == null ? null : this.extractStringValue(value, attribute);
  }
  static extractBooleanValue(value: unknown, allowStringCoercion = true): boolean {
    const input = objectValue(value) && 'active' in value ? value.active : value;
    if (typeof input === 'boolean') return input;
    if (allowStringCoercion && typeof input === 'string' && /^(true|false)$/i.test(input)) return input.toLowerCase() === 'true';
    throw new PatchError(400, 'Patch operation requires boolean value for active.', 'invalidValue');
  }
  static stripReservedAttributes(payload: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(payload).filter(([key]) => !reserved.has(key.toLowerCase())));
  }
}
