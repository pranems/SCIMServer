/**
 * NestJS injection tokens for repository interfaces.
 *
 * Usage:
 *   @Inject(USER_REPOSITORY) private readonly userRepo: IUserRepository
 */
export const USER_REPOSITORY = 'USER_REPOSITORY';
export const GROUP_REPOSITORY = 'GROUP_REPOSITORY';
export const GENERIC_RESOURCE_REPOSITORY = 'GENERIC_RESOURCE_REPOSITORY';
export const ENDPOINT_CREDENTIAL_REPOSITORY = 'ENDPOINT_CREDENTIAL_REPOSITORY';
