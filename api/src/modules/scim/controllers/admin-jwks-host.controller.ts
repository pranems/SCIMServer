import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, BadRequestException, NotFoundException } from '@nestjs/common';
import { JwksHostAllowlistService, type JwksAllowlistView } from '../../../oauth/jwks-host-allowlist.service';
import { ScimLogger, getCorrelationContext } from '../../logging/scim-logger.service';
import { LogCategory } from '../../logging/log-levels';
import { emitAuthAdminEvent } from '../../../oauth/auth-admin-event';

interface AddJwksHostDto {
  host?: string;
  label?: string;
}

interface UpdateJwksHostDto {
  host?: string;
  label?: string;
}

interface PatchJwksHostsDto {
  add?: string[];
  remove?: string[];
}

/** Validate a bare hostname (no scheme, port, path, or spaces). Throws 400. */
function assertBareHost(host: string): void {
  if (host === '') {
    throw new BadRequestException('A non-empty "host" is required.');
  }
  if (/[\s/:]/.test(host)) {
    throw new BadRequestException(
      `"${host}" is not a bare hostname (no scheme, port, path, or spaces).`,
    );
  }
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
  constructor(
    private readonly allowlist: JwksHostAllowlistService,
    private readonly logger: ScimLogger,
  ) {}

  /** GET - the three layers + the effective union. */
  @Get()
  list(): JwksAllowlistView {
    return this.allowlist.view();
  }

  /** POST - add a host to the persisted layer (hot-reloaded). */
  @Post()
  async add(@Body() body: AddJwksHostDto): Promise<JwksAllowlistView> {
    const host = (body?.host ?? '').trim().toLowerCase();
    assertBareHost(host);
    const view = await this.allowlist.addHost(host, body.label ?? null);
    // Phase 4 - config-time auth audit event (a JWKS host is a WIF trust root).
    emitAuthAdminEvent(
      this.logger,
      { action: 'jwks_host_add', outcome: 'success', host, correlationId: getCorrelationContext()?.requestId },
      LogCategory.AUTH,
    );
    return view;
  }

  /** PUT - edit a persisted entry by id (change host and/or label). R1. */
  @Put(':id')
  @HttpCode(200)
  async update(@Param('id') id: string, @Body() body: UpdateJwksHostDto): Promise<JwksAllowlistView> {
    const host = (body?.host ?? '').trim().toLowerCase();
    assertBareHost(host);
    const { updated, view } = await this.allowlist.updateHost(id, host, body.label ?? null);
    if (!updated) {
      throw new NotFoundException(`No JWKS host allowlist entry with id "${id}".`);
    }
    emitAuthAdminEvent(
      this.logger,
      { action: 'jwks_host_update', outcome: 'success', host, correlationId: getCorrelationContext()?.requestId },
      LogCategory.AUTH,
    );
    return view;
  }

  /**
   * PATCH - selectively add AND/OR remove hosts in a single call (R1).
   * Body: { add?: string[], remove?: string[] }. Each host must be a bare
   * hostname. Returns the counts actually changed + the fresh view.
   */
  @Patch()
  @HttpCode(200)
  async patch(@Body() body: PatchJwksHostsDto): Promise<{ added: number; removed: number; view: JwksAllowlistView }> {
    const add = Array.isArray(body?.add) ? body.add : [];
    const remove = Array.isArray(body?.remove) ? body.remove : [];
    if (add.length === 0 && remove.length === 0) {
      throw new BadRequestException('Provide at least one host in "add" or "remove".');
    }
    // Validate every add host as a bare hostname (remove is lenient - removing
    // a non-existent host is simply a no-op).
    const normalizedAdd = add.map((h) => (h ?? '').trim().toLowerCase());
    for (const h of normalizedAdd) {
      assertBareHost(h);
    }
    const normalizedRemove = remove.map((h) => (h ?? '').trim().toLowerCase());
    const result = await this.allowlist.patchHosts(normalizedAdd, normalizedRemove);
    emitAuthAdminEvent(
      this.logger,
      {
        action: 'jwks_host_patch',
        outcome: 'success',
        hostsAdded: normalizedAdd.length > 0 ? normalizedAdd : undefined,
        hostsRemoved: normalizedRemove.length > 0 ? normalizedRemove : undefined,
        correlationId: getCorrelationContext()?.requestId,
      },
      LogCategory.AUTH,
    );
    return result;
  }

  /** DELETE - remove a host from the persisted layer (seed/env hosts are unaffected). */
  @Delete(':host')
  @HttpCode(200)
  async remove(@Param('host') host: string): Promise<{ removed: boolean; view: JwksAllowlistView }> {
    const result = await this.allowlist.removeHost(host);
    emitAuthAdminEvent(
      this.logger,
      {
        action: 'jwks_host_remove',
        outcome: 'success',
        host,
        detail: result.removed ? undefined : 'no matching persisted host',
        correlationId: getCorrelationContext()?.requestId,
      },
      LogCategory.AUTH,
    );
    return result;
  }
}
