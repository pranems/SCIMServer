import { RepositoryError } from './repository-error';

/** A create lost its owning endpoint, not a resource-version comparison. */
export class EndpointNotFoundError extends RepositoryError {
  constructor(cause?: Error) {
    super('NOT_FOUND', 'Endpoint no longer exists', cause);
    this.name = 'EndpointNotFoundError';
  }
}
