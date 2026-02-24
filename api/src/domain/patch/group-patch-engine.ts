/**
 * Group PATCH Engine (Phase 5)
 *
 * Pure domain class that applies SCIM PATCH operations to a group's in-memory state.
 * Zero NestJS / Prisma / DB dependencies — takes plain data in, returns plain data out.
 *
 * Responsibilities:
 *   - Operation dispatch (add / replace / remove) for groups
 *   - Member management: add, remove, replace (including multi-member config enforcement)
 *   - Display field updates: displayName, externalId
 *   - Deduplication of member lists
 *
 * The calling service handles: DB load, member resolution, DB save, meta generation.
 *
 * @see RFC 7644 §3.5.2 — Modifying with PATCH
 */

import type {
  PatchOperation,
  GroupMemberPatchConfig,
  GroupPatchResult,
  GroupMemberDto,
} from './patch-types';

import {
  isExtensionPath,
  parseExtensionPath,
  applyExtensionUpdate,
  removeExtensionAttribute,
  resolveNoPathValue,
} from '../../modules/scim/utils/scim-patch-path';

import { PatchError } from './patch-error';

// ─── Input State ─────────────────────────────────────────────────────────────

/** Current group state provided by the service before PATCH application */
export interface GroupPatchState {
  displayName: string;
  externalId: string | null;
  members: GroupMemberDto[];
  rawPayload: Record<string, unknown>;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export class GroupPatchEngine {
  /**
   * Apply an array of SCIM PATCH operations to the given group state.
   *
   * @param operations  - SCIM PatchOperation[] from the request DTO
   * @param state       - Current group values (from DB record + members)
   * @param config      - Group member PATCH config flags
   * @returns           - Updated display fields + member list
   * @throws PatchError - On invalid op / path / value
   */
  static apply(
    operations: PatchOperation[],
    state: GroupPatchState,
    config: GroupMemberPatchConfig,
  ): GroupPatchResult {
    let { displayName, externalId } = state;
    let members = [...state.members];
    let rawPayload = { ...state.rawPayload };

    for (const operation of operations) {
      const op = operation.op?.toLowerCase();
      if (!op || !['add', 'replace', 'remove'].includes(op)) {
        throw new PatchError(
          400,
          `Patch operation '${operation.op}' is not supported.`,
          'invalidValue',
        );
      }

      switch (op) {
        case 'replace': {
          const result = GroupPatchEngine.handleReplace(
            operation, displayName, externalId, members, rawPayload, config,
          );
          displayName = result.displayName;
          externalId = result.externalId;
          members = result.members;
          rawPayload = result.rawPayload;
          break;
        }
        case 'add':
          // Check for extension path first; otherwise delegate to member-only handler
          if (operation.path && isExtensionPath(operation.path, config.extensionUrns)) {
            const extParsed = parseExtensionPath(operation.path, config.extensionUrns);
            if (extParsed) {
              rawPayload = applyExtensionUpdate({ ...rawPayload }, extParsed, operation.value);
              break;
            }
          }
          members = GroupPatchEngine.handleAdd(
            operation, members, config.allowMultiMemberAdd,
          );
          break;
        case 'remove':
          // Check for extension path first; otherwise delegate to member-only handler
          if (operation.path && isExtensionPath(operation.path, config.extensionUrns)) {
            const extParsed = parseExtensionPath(operation.path, config.extensionUrns);
            if (extParsed) {
              rawPayload = removeExtensionAttribute({ ...rawPayload }, extParsed);
              break;
            }
          }
          members = GroupPatchEngine.handleRemove(
            operation, members, config.allowMultiMemberRemove, config.allowRemoveAllMembers,
          );
          break;
      }
    }

    return { displayName, externalId, payload: rawPayload, members };
  }

  // ─── Replace ─────────────────────────────────────────────────────────

  private static handleReplace(
    operation: PatchOperation,
    currentDisplayName: string,
    currentExternalId: string | null,
    members: GroupMemberDto[],
    rawPayload: Record<string, unknown>,
    config: GroupMemberPatchConfig,
  ): { displayName: string; externalId: string | null; members: GroupMemberDto[]; rawPayload: Record<string, unknown> } {
    const path = operation.path?.toLowerCase();
    const originalPath = operation.path;

    // No path — value is either a string (displayName) or an object with attribute(s)
    if (!path) {
      if (typeof operation.value === 'string') {
        return { displayName: operation.value, externalId: currentExternalId, members, rawPayload };
      }
      if (typeof operation.value === 'object' && operation.value !== null) {
        const obj = operation.value as Record<string, unknown>;
        let newDisplayName = currentDisplayName;
        let newExternalId = currentExternalId;
        let newMembers = members;

        if (typeof obj.displayName === 'string') {
          newDisplayName = obj.displayName;
        }
        if ('externalId' in obj) {
          newExternalId = typeof obj.externalId === 'string' ? obj.externalId : null;
        }
        if (Array.isArray(obj.members)) {
          newMembers = (obj.members as unknown[]).map(m => GroupPatchEngine.toMemberDto(m));
          newMembers = GroupPatchEngine.ensureUniqueMembers(newMembers);
        }

        // Store any other attributes in rawPayload (resolves extension URN keys)
        const updateObj: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(obj)) {
          if (key !== 'displayName' && key !== 'externalId' && key !== 'members' && key !== 'schemas') {
            updateObj[key] = val;
          }
        }
        const updatedPayload = resolveNoPathValue({ ...rawPayload }, updateObj, config.extensionUrns);

        return { displayName: newDisplayName, externalId: newExternalId, members: newMembers, rawPayload: updatedPayload };
      }
      throw new PatchError(
        400,
        'Replace operation requires a string or object value.',
        'invalidValue',
      );
    }

    if (path === 'displayname') {
      if (typeof operation.value !== 'string') {
        throw new PatchError(
          400,
          'Replace operation for displayName requires a string value.',
          'invalidValue',
        );
      }
      return { displayName: operation.value, externalId: currentExternalId, members, rawPayload };
    }

    if (path === 'externalid') {
      const newExtId = typeof operation.value === 'string' ? operation.value : null;
      return { displayName: currentDisplayName, externalId: newExtId, members, rawPayload };
    }

    if (path === 'members') {
      if (!Array.isArray(operation.value)) {
        throw new PatchError(
          400,
          'Replace operation for members requires an array value.',
          'invalidValue',
        );
      }
      const normalized = (operation.value as unknown[]).map(m => GroupPatchEngine.toMemberDto(m));
      return {
        displayName: currentDisplayName,
        externalId: currentExternalId,
        members: GroupPatchEngine.ensureUniqueMembers(normalized),
        rawPayload,
      };
    }

    // Extension URN-prefixed path (e.g., urn:...:CustomExt:myAttr)
    if (originalPath && isExtensionPath(originalPath, config.extensionUrns)) {
      const extParsed = parseExtensionPath(originalPath, config.extensionUrns);
      if (extParsed) {
        const updatedPayload = applyExtensionUpdate({ ...rawPayload }, extParsed, operation.value);
        return { displayName: currentDisplayName, externalId: currentExternalId, members, rawPayload: updatedPayload };
      }
    }

    throw new PatchError(
      400,
      `Patch path '${operation.path ?? ''}' is not supported.`,
      'invalidPath',
    );
  }

  // ─── Add ─────────────────────────────────────────────────────────────

  private static handleAdd(
    operation: PatchOperation,
    members: GroupMemberDto[],
    allowMultiMemberAdd: boolean,
  ): GroupMemberDto[] {
    const path = operation.path?.toLowerCase();
    if (path && path !== 'members') {
      throw new PatchError(
        400,
        `Add operation path '${operation.path ?? ''}' is not supported.`,
        'invalidPath',
      );
    }

    if (!operation.value) {
      throw new PatchError(
        400,
        'Add operation for members requires a value.',
        'invalidValue',
      );
    }

    const value = Array.isArray(operation.value) ? operation.value : [operation.value];

    if (!allowMultiMemberAdd && value.length > 1) {
      throw new PatchError(
        400,
        'Adding multiple members in a single operation is not allowed. ' +
        'Each member must be added in a separate PATCH operation. ' +
        'To enable multi-member add, set endpoint config flag "MultiOpPatchRequestAddMultipleMembersToGroup" to "True".',
        'invalidValue',
      );
    }

    const newMembers = value.map(m => GroupPatchEngine.toMemberDto(m));
    return GroupPatchEngine.ensureUniqueMembers([...members, ...newMembers]);
  }

  // ─── Remove ──────────────────────────────────────────────────────────

  private static handleRemove(
    operation: PatchOperation,
    members: GroupMemberDto[],
    allowMultiMemberRemove: boolean,
    allowRemoveAllMembers: boolean,
  ): GroupMemberDto[] {
    const path = operation.path?.toLowerCase();

    // Value array with members to remove
    if (operation.value && Array.isArray(operation.value) && operation.value.length > 0) {
      if (!allowMultiMemberRemove && operation.value.length > 1) {
        throw new PatchError(
          400,
          'Removing multiple members in a single operation is not allowed. ' +
          'Each member must be removed in a separate PATCH operation. ' +
          'To enable multi-member remove, set endpoint config flag "MultiOpPatchRequestRemoveMultipleMembersFromGroup" to "True".',
          'invalidValue',
        );
      }

      const membersToRemove = new Set<string>();
      for (const item of operation.value as unknown[]) {
        if (item && typeof item === 'object' && 'value' in item) {
          membersToRemove.add((item as { value: string }).value);
        }
      }
      return members.filter(m => !membersToRemove.has(m.value));
    }

    // Targeted removal: members[value eq "user-id"]
    const memberPathMatch = path?.match(/^members\[value\s+eq\s+"?([^"]+)"?\]$/i);
    if (memberPathMatch) {
      const valueToRemove = memberPathMatch[1];
      return members.filter(m => m.value !== valueToRemove);
    }

    // path=members without value — remove all members
    if (path === 'members') {
      if (!allowRemoveAllMembers) {
        throw new PatchError(
          400,
          'Removing all members via path=members is not allowed. ' +
          'Specify members to remove using a value array or path filter like members[value eq "user-id"]. ' +
          'To enable remove-all, set endpoint config flag "PatchOpAllowRemoveAllMembers" to "True".',
          'invalidValue',
        );
      }
      return [];
    }

    throw new PatchError(
      400,
      `Remove operation path '${operation.path ?? ''}' is not supported for groups.`,
      'invalidPath',
    );
  }

  // ─── Member utilities ────────────────────────────────────────────────

  static toMemberDto(member: unknown): GroupMemberDto {
    if (!member || typeof member !== 'object' || !('value' in member)) {
      throw new PatchError(
        400,
        'Member object must include a value property.',
        'invalidValue',
      );
    }
    const typed = member as { value: string; display?: string; type?: string };
    return {
      value: typed.value,
      display: typed.display,
      type: typed.type,
    };
  }

  static ensureUniqueMembers(members: GroupMemberDto[]): GroupMemberDto[] {
    const seen = new Map<string, GroupMemberDto>();
    for (const member of members) {
      seen.set(member.value, member);
    }
    return Array.from(seen.values());
  }
}
