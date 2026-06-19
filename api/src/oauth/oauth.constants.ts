/**
 * OAuth issuer identity shared by the JWT signer and the RFC 8414 metadata.
 *
 * The issued token's `iss` claim and the published metadata `issuer` MUST be
 * the same value (RFC 8414 - the metadata issuer must match the token iss), so
 * both read this single constant.
 *
 * Kept in a leaf module to avoid a circular import between oauth.module.ts
 * (which wires the JwtModule signOptions.issuer) and the metadata controller.
 */
export const OAUTH_ISSUER = 'scimserver-oauth-server';

/** The RFC 8414 well-known path (served at the deployment root, outside the API prefix). */
export const OAUTH_METADATA_PATH = '.well-known/oauth-authorization-server';
