import { EndpointNotFoundError } from '../../../domain/errors/endpoint-not-found.error';
import { RepositoryError } from '../../../domain/errors/repository-error';
import type { PrismaService } from '../../../modules/prisma/prisma.service';
import { wrapPrismaError } from './prisma-error.util';

function safeCreateError(error: unknown, context: string): RepositoryError {
  const translated = wrapPrismaError(error, context);
  return translated.code === 'UNKNOWN'
    ? new RepositoryError('UNKNOWN', 'Unexpected persistence failure', translated.cause)
    : translated;
}

/**
 * Classify only failed endpoint-owned INSERTs. A relation error alone cannot
 * identify its missing parent: confirm the endpoint is absent before saying 404.
 * Never use this read to reinterpret conditional UPDATE/DELETE results.
 */
export async function wrapEndpointCreateError(
  error: unknown,
  context: string,
  endpointId: string,
  prisma: Pick<PrismaService, 'endpoint'>,
): Promise<RepositoryError> {
  if (error instanceof RepositoryError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'P2003' || code === 'P2025') {
    let endpoint: { id: string } | null;
    try {
      endpoint = await prisma.endpoint.findUnique({
        where: { id: endpointId },
        select: { id: true },
      });
    } catch (lookupError) {
      // Absence was not proven. A failed read is not a missing endpoint.
      return safeCreateError(lookupError, context);
    }
    if (endpoint === null) {
      return new EndpointNotFoundError(error instanceof Error ? error : undefined);
    }
  }
  return safeCreateError(error, context);
}
