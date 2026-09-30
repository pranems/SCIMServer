import { PatchExecutor, type PatchExecutionOptions } from './patch-executor';
import type { PatchOperation } from './patch-types';

/** Dynamic core/extension adapter; all attribute execution is shared. */
export class GenericPatchEngine {
  private readonly executor: PatchExecutor;
  constructor(
    payload: Record<string, unknown>,
    extensionUrns?: readonly string[],
    caseExactPaths?: ReadonlySet<string>,
    coreUrn?: string,
    options: PatchExecutionOptions = {},
  ) {
    this.executor = new PatchExecutor(payload, { ...options, extensionUrns, caseExactPaths, coreUrn });
  }
  apply(operation: PatchOperation): void { this.executor.apply(operation); }
  getResult(): Record<string, unknown> { return this.executor.getResult(); }
}
