/**
 * Domain-layer PATCH error.
 *
 * Thrown by PatchEngine when PATCH operations are invalid.
 * Services catch this and convert to framework-specific HTTP errors.
 */
export class PatchError extends Error {
  public readonly status: number;
  public readonly scimType: string | undefined;
  /** Zero-based index of the failing operation within the PATCH request */
  public readonly operationIndex?: number;
  /** The path from the failing PATCH operation */
  public readonly failedPath?: string;
  /** The op type from the failing operation (add/replace/remove) */
  public readonly failedOp?: string;

  constructor(
    status: number,
    detail: string,
    scimType?: string,
    context?: { operationIndex?: number; path?: string; op?: string },
  ) {
    super(detail);
    this.name = 'PatchError';
    this.status = status;
    this.scimType = scimType;
    this.operationIndex = context?.operationIndex;
    this.failedPath = context?.path;
    this.failedOp = context?.op;
  }
}
