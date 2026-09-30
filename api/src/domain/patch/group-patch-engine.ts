import type { PatchOperation, GroupMemberPatchConfig, GroupPatchResult, GroupMemberDto } from './patch-types';
import { PatchExecutor } from './patch-executor';
import { PatchError } from './patch-error';
import { matchesPatchSelection, parsePatchTarget } from './patch-path';
import { objectValue } from './patch-values';
import { readResolvedProperty as read, withResolvedProperty as put } from '../../modules/scim/utils/scim-patch-path';

export interface GroupPatchState {
  displayName: string;
  externalId: string | null;
  members: GroupMemberDto[];
  rawPayload: Record<string, unknown>;
}

/** Group member policy and DTO adapter; ordinary attribute mutations are shared. */
export class GroupPatchEngine {
  static apply(operations: PatchOperation[], state: GroupPatchState, config: GroupMemberPatchConfig): GroupPatchResult {
    let noPathKeys = new Set<string>();
    const exact = new Set(config.caseExactPaths);
    if (exact.has('value')) exact.add('members.value');
    const executor = new PatchExecutor({
      ...state.rawPayload, displayName: state.displayName, externalId: state.externalId, members: state.members,
    }, {
      ...config, caseExactPaths: exact,
      normalize: (candidate, operation) => {
        candidate.members = this.ensureUniqueMembers(((candidate.members ?? []) as unknown[]).map(m => this.toMemberDto(m)));
        config.normalize?.(candidate, operation);
      },
    }, {
      normalizeOperation: input => {
        let operation = input;
        noPathKeys = new Set(!input.path && objectValue(input.value) ? Object.keys(input.value).map(k => k.toLowerCase()) : []);
        if (!operation.path) {
          if (operation.op.toLowerCase() === 'replace' && typeof operation.value === 'string') {
            operation = { ...operation, path: 'displayName' };
          } else if (operation.op.toLowerCase() === 'add' &&
            (Array.isArray(operation.value) || (objectValue(operation.value) && 'value' in operation.value))) {
            operation = { ...operation, path: 'members' };
          }
        }
        if (operation.path) {
          const path = parsePatchTarget(operation.path, config.extensionUrns);
          if (!path.schemaUrn && path.attribute.toLowerCase() === 'members' && path.kind === 'selection' &&
            !path.subAttribute && Array.isArray(operation.value) && operation.value.length === 1 &&
            operation.op.toLowerCase() !== 'remove') operation = { ...operation, value: operation.value[0] };
        }
        return operation;
      },
      mutate: (candidate, path, operation) => {
        if (path.schemaUrn) return undefined;
        const key = path.attribute.toLowerCase();
        const op = operation.op;
        if (!noPathKeys.has(key) && !['displayname', 'externalid', 'members', 'id'].includes(key) &&
          !config.schemaDefinitions?.some(s => s.isCoreSchema && s.attributes.some(a => a.name.toLowerCase() === key)) &&
          operation.path && !objectValue(read(candidate, key))) {
          throw new PatchError(400, `Patch path '${operation.path}' is not supported.`, 'invalidPath');
        }
        if (key === 'externalid' && !path.subAttribute && path.kind !== 'selection') {
          return put(candidate, 'externalId', typeof operation.value === 'string' && op !== 'remove' ? operation.value : null);
        }
        if (key === 'displayname' && !path.subAttribute) {
          if (op === 'remove') throw new PatchError(400, 'Cannot remove required displayName.', 'invalidValue');
          if (typeof operation.value !== 'string') throw new PatchError(400, 'displayName requires a string value.', 'invalidValue');
        }
        if (key !== 'members') return undefined;
        const members = read(candidate, 'members') as GroupMemberDto[] ?? [];
        if (op === 'add' && !path.subAttribute && path.kind !== 'selection') {
          const incoming = Array.isArray(operation.value) ? operation.value : [operation.value];
          if (!config.allowMultiMemberAdd && incoming.length > 1) {
            throw new PatchError(400, 'Adding multiple members in a single operation is not allowed.', 'invalidValue');
          }
          incoming.forEach(m => this.toMemberDto(m));
        }
        if (op === 'replace' && path.kind !== 'selection' && !path.subAttribute &&
            operation.value !== null && !Array.isArray(operation.value)) {
          throw new PatchError(400, 'Replace operation for members requires an array value (or null to clear).', 'invalidValue');
        }
        if (op !== 'remove') return undefined;
        // Entra compatibility: explicit value arrays override the selector.
        if (Array.isArray(operation.value) && operation.value.length > 0) {
          if (!config.allowMultiMemberRemove && operation.value.length > 1) {
            throw new PatchError(400, 'Removing multiple members in a single operation is not allowed.', 'invalidValue');
          }
          const values = new Set(operation.value.map(m => this.toMemberDto(m).value));
          return put(candidate, 'members', members.filter(m => !values.has(m.value)));
        }
        if (path.kind === 'selection') {
          // Named compatibility: zero-match Group-member remove is idempotent.
          if (!members.some(m => matchesPatchSelection(path, m as unknown as Record<string, unknown>, exact))) return candidate;
          return undefined;
        }
        if (!config.allowRemoveAllMembers && !path.subAttribute) {
          throw new PatchError(400, 'Removing all members via path=members is not allowed.', 'invalidValue');
        }
        return undefined;
      },
    });
    operations.forEach(op => executor.apply(op));
    const result = executor.getResult();
    const { displayName, externalId, members, ...payload } = result;
    delete payload.schemas;
    delete payload.meta;
    return { displayName: displayName as string, externalId: externalId as string ?? null, members: members as GroupMemberDto[], payload };
  }
  static toMemberDto(member: unknown): GroupMemberDto {
    if (!objectValue(member) || typeof read(member, 'value') !== 'string' || !read(member, 'value')) {
      throw new PatchError(400, 'Member object must include a non-empty string value property.', 'invalidValue');
    }
    return { value: read(member, 'value') as string, display: read(member, 'display') as string, type: read(member, 'type') as string };
  }
  static ensureUniqueMembers(members: GroupMemberDto[]): GroupMemberDto[] {
    return Array.from(new Map(members.map(m => [m.value, m])).values());
  }
}
