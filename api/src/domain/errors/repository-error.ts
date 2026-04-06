/**
 * RepositoryError — Domain-level error from repository operations.
 *
 * Translates backend-specific errors (Prisma P2025, InMemory "not found")
 * into a consistent typed error that the service layer can catch and convert
 * to SCIM-compliant error responses.
 *
 * Error codes:
 *   NOT_FOUND   — Record does not exist (→ 404)
 *   CONFLICT    — Uniqueness constraint violation (→ 409)
 *   CONNECTION  — Database connectivity issue (→ 503)
 *   UNKNOWN     — Unexpected error (→ 500)
 *
 * @see Phase A Step 2 — LOGGING_ERROR_HANDLING_IDEAL_DESIGN.md §7
 */
export type RepositoryErrorCode = 'NOT_FOUND' | 'CONFLICT' | 'CONNECTION' | 'UNKNOWN';

export class RepositoryError extends Error {
  /** Discriminator for instanceof checks across module boundaries */
  readonly isRepositoryError = true;

  constructor(
    /** Categorized error code */
    public readonly code: RepositoryErrorCode,
    /** Human-readable detail message */
    message: string,
    /** Original backend error for stack trace preservation */
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'RepositoryError';
    // Preserve the original stack trace chain
    if (cause?.stack) {
      this.stack = `${this.stack}\n  Caused by: ${cause.stack}`;
    }
  }
}

/**
 * Map RepositoryError codes to HTTP status codes.
 * Used by service-layer catch blocks to produce the correct SCIM error status.
 */
export function repositoryErrorToHttpStatus(code: RepositoryErrorCode): number {
  switch (code) {
    case 'NOT_FOUND':  return 404;
    case 'CONFLICT':   return 409;
    case 'CONNECTION': return 503;
    case 'UNKNOWN':    return 500;
  }
}
