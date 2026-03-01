/**
 * Domain-layer PATCH error.
 *
 * Thrown by PatchEngine when PATCH operations are invalid.
 * Services catch this and convert to framework-specific HTTP errors.
 */
export class PatchError extends Error {
  public readonly status: number;
  public readonly scimType: string | undefined;

  constructor(status: number, detail: string, scimType?: string) {
    super(detail);
    this.name = 'PatchError';
    this.status = status;
    this.scimType = scimType;
  }
}
