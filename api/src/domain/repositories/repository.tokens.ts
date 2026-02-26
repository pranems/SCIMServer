/**
 * NestJS injection tokens for repository interfaces.
 *
 * Usage:
 *   @Inject(USER_REPOSITORY) private readonly userRepo: IUserRepository
 */
export const USER_REPOSITORY = 'USER_REPOSITORY';
export const GROUP_REPOSITORY = 'GROUP_REPOSITORY';
export const ENDPOINT_SCHEMA_REPOSITORY = 'ENDPOINT_SCHEMA_REPOSITORY';
export const ENDPOINT_RESOURCE_TYPE_REPOSITORY = 'ENDPOINT_RESOURCE_TYPE_REPOSITORY';
export const GENERIC_RESOURCE_REPOSITORY = 'GENERIC_RESOURCE_REPOSITORY';
