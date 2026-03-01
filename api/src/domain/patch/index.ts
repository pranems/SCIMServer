/**
 * Domain PATCH Engine — barrel export (Phase 5)
 */
export { PatchError } from './patch-error';

export type {
  PatchOperation,
  PatchConfig,
  GroupMemberPatchConfig,
  UserPatchResult,
  UserExtractedFields,
  GroupPatchResult,
  GroupMemberDto,
} from './patch-types';

export { UserPatchEngine } from './user-patch-engine';
export type { UserPatchState } from './user-patch-engine';

export { GroupPatchEngine } from './group-patch-engine';
export type { GroupPatchState } from './group-patch-engine';
