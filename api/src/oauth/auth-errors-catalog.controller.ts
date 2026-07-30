import { Controller, Get, Header, Query } from '@nestjs/common';
import { Public } from '../modules/auth/public.decorator';
import { AUTH_REASON_CATALOG, type AuthPlane } from './auth-reason-catalog';

/**
 * WI-D2: Public reference endpoint for the auth-failure reason-code catalog.
 *
 * Served at `GET /scim/docs/auth-errors` (publicly - it is documentation, no
 * secrets), it is the single machine-readable source of truth for the reason
 * codes an operator (or an integrating client) will see in a token error's
 * `reason_code`, in the AUTH log events, and in the admin diagnostics UI. The
 * wire error, human description, remediation, and visibility tier all come from
 * the same catalog module the runtime uses, so they can never drift.
 */
@Controller('docs')
export class AuthErrorsCatalogController {
  @Public()
  @Get('auth-errors')
  @Header('Cache-Control', 'public, max-age=3600')
  getCatalog(@Query('plane') plane?: string): Record<string, unknown> {
    const validPlanes: AuthPlane[] = ['wif', 'oauth_client', 'bearer'];
    const planeFilter = validPlanes.includes(plane as AuthPlane) ? (plane as AuthPlane) : undefined;

    const entries = AUTH_REASON_CATALOG.filter((e) => !planeFilter || e.plane === planeFilter).map(
      (e) => ({
        reasonCode: e.reasonCode,
        wireError: e.wireError,
        plane: e.plane,
        tier: e.tier,
        actorDescription: e.actorDescription,
        remediation: e.remediation,
      }),
    );

    return {
      description:
        'Auth-failure reason-code catalog. reason_code appears in token-endpoint error bodies, AUTH log events, and the admin diagnostics UI.',
      docsUrl:
        'https://github.com/pranems/scimserver/blob/main/docs/auth/AUTH_ERROR_DIAGNOSTICS_AND_OBSERVABILITY.md',
      count: entries.length,
      reasons: entries,
    };
  }
}
