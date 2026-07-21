import { inferAllowedTenantId } from './infer-allowed-tenant-id';

/**
 * U8 - unit tests for the pure `inferAllowedTenantId` gleaner. Covers the Entra
 * commercial / gov / china host shapes, the v1 `sts.windows.net` issuer, the
 * JWKS-only fallback, the issuer-preference rule, and the non-inferable cases
 * that must return null (tenant stays optional).
 */
describe('inferAllowedTenantId (U8)', () => {
  const TENANT = '72f988bf-86f1-41af-91ab-2d7cd011db47';

  it('gleans the tenant from an Entra COMMERCIAL v2 issuer', () => {
    expect(
      inferAllowedTenantId(`https://login.microsoftonline.com/${TENANT}/v2.0`, undefined),
    ).toEqual({ tenantId: TENANT, source: 'issuer' });
  });

  it('gleans the tenant from an Entra US-GOV issuer', () => {
    expect(
      inferAllowedTenantId(`https://login.microsoftonline.us/${TENANT}/v2.0`, undefined),
    ).toEqual({ tenantId: TENANT, source: 'issuer' });
  });

  it('gleans the tenant from an Entra CHINA issuer', () => {
    expect(
      inferAllowedTenantId(`https://login.partner.microsoftonline.cn/${TENANT}/v2.0`, undefined),
    ).toEqual({ tenantId: TENANT, source: 'issuer' });
  });

  it('gleans the tenant from a v1 sts.windows.net issuer', () => {
    expect(
      inferAllowedTenantId(`https://sts.windows.net/${TENANT}/`, undefined),
    ).toEqual({ tenantId: TENANT, source: 'issuer' });
  });

  it('falls back to the JWKS URI when the issuer carries no tenant GUID', () => {
    expect(
      inferAllowedTenantId(
        'https://accounts.google.com',
        `https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`,
      ),
    ).toEqual({ tenantId: TENANT, source: 'jwksUri' });
  });

  it('prefers the issuer over the JWKS URI when both carry a tenant GUID', () => {
    const other = '11111111-2222-3333-4444-555555555555';
    expect(
      inferAllowedTenantId(
        `https://login.microsoftonline.com/${TENANT}/v2.0`,
        `https://login.microsoftonline.com/${other}/discovery/v2.0/keys`,
      ),
    ).toEqual({ tenantId: TENANT, source: 'issuer' });
  });

  it('returns null for a non-inferable issuer + JWKS (tenant stays optional)', () => {
    expect(
      inferAllowedTenantId('https://accounts.google.com', 'https://www.googleapis.com/oauth2/v3/certs'),
    ).toBeNull();
  });

  it('returns null when the tenant placeholder is a keyword, not a GUID', () => {
    expect(
      inferAllowedTenantId('https://login.microsoftonline.com/common/v2.0', undefined),
    ).toBeNull();
  });

  it('normalizes an upper-case GUID to lower case', () => {
    expect(
      inferAllowedTenantId(`https://login.microsoftonline.com/${TENANT.toUpperCase()}/v2.0`, undefined),
    ).toEqual({ tenantId: TENANT, source: 'issuer' });
  });

  it('returns null for empty / undefined inputs', () => {
    expect(inferAllowedTenantId(undefined, undefined)).toBeNull();
    expect(inferAllowedTenantId('', '')).toBeNull();
  });
});
