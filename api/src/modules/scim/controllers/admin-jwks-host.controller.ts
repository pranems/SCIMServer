import { Body, Controller, Delete, Get, HttpCode, Param, Post, BadRequestException } from '@nestjs/common';
import { JwksHostAllowlistService, type JwksAllowlistView } from '../../../oauth/jwks-host-allowlist.service';

interface AddJwksHostDto {
  host?: string;
  label?: string;
}

/**
 * AdminJwksHostController (WI-15) - the admin API for the runtime-editable JWKS
 * host allowlist. Server-global (not per-endpoint). The effective allowlist is
 * the union of a compiled seed + the JWKS_HOST_ALLOWLIST env + these persisted
 * admin-added rows; adding/removing hot-reloads the union immediately.
 *
 * Convenience/runtime-flexibility feature - no deny-list, no lock flag. The
 * existing https + exact-host-match SSRF validation is retained by the callers.
 */
@Controller('admin/settings/jwks-hosts')
export class AdminJwksHostController {
  constructor(private readonly allowlist: JwksHostAllowlistService) {}

  /** GET - the three layers + the effective union. */
  @Get()
  list(): JwksAllowlistView {
    return this.allowlist.view();
  }

  /** POST - add a host to the persisted layer (hot-reloaded). */
  @Post()
  async add(@Body() body: AddJwksHostDto): Promise<JwksAllowlistView> {
    const host = (body?.host ?? '').trim().toLowerCase();
    if (host === '') {
      throw new BadRequestException('A non-empty "host" is required.');
    }
    // Basic hostname sanity: no scheme, no path, no spaces.
    if (/[\s/:]/.test(host)) {
      throw new BadRequestException(
        `"${host}" is not a bare hostname (no scheme, port, path, or spaces).`,
      );
    }
    return this.allowlist.addHost(host, body.label ?? null);
  }

  /** DELETE - remove a host from the persisted layer (seed/env hosts are unaffected). */
  @Delete(':host')
  @HttpCode(200)
  async remove(@Param('host') host: string): Promise<{ removed: boolean; view: JwksAllowlistView }> {
    return this.allowlist.removeHost(host);
  }
}
