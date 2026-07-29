import { Controller, Get, Header } from '@nestjs/common';
import {
  resolveRuntimeConfig,
  type ResolvedSetting,
  type RuntimeConfigGroup,
} from '../../../bootstrap/runtime-config';

/** Custom URN for the admin runtime-config projection. */
const RUNTIME_CONFIG_SCHEMA = 'urn:scimserver:params:scim:schemas:admin:2.0:RuntimeConfig';

export interface RuntimeConfigResponse {
  schemas: string[];
  groups: Record<RuntimeConfigGroup, Record<string, ResolvedSetting>>;
  /** Cross-key invariant violations. Advisory - the server still started. */
  invariantWarnings: string[];
}

/**
 * W1.7c - `GET /scim/admin/runtime-config`.
 *
 * Answers "what configuration actually took effect?" with a fact rather than
 * "what do you have set?". Every tunable is returned with its effective value,
 * where it came from (`env` / `legacy-env` / `default`), its published bounds,
 * and - the case an operator most needs to see - whether it had to be CLAMPED
 * and what was originally requested.
 *
 * SECURITY: this payload contains no secrets BY CONSTRUCTION, not by filtering.
 * It is assembled from `RUNTIME_CONFIG_SPECS`, a fixed table of numeric and
 * byte-size tuning values; `DATABASE_URL`, `OAUTH_CLIENT_SECRET`,
 * `SCIM_SHARED_SECRET` and `JWKS_HOST_ALLOWLIST` are not in that table and
 * therefore cannot appear here even if a future spec entry is added carelessly -
 * only values the table names are ever read. A key-allowlist spec locks it.
 *
 * Admin-only: no `@Public`, so the default bearer guard applies. `no-store`
 * because the response reflects live process state and must never be cached by
 * an intermediary.
 */
@Controller('admin')
export class RuntimeConfigController {
  @Get('runtime-config')
  @Header('Cache-Control', 'no-store')
  get(): RuntimeConfigResponse {
    const config = resolveRuntimeConfig((k) => process.env[k]);
    return {
      schemas: [RUNTIME_CONFIG_SCHEMA],
      groups: config.groups,
      invariantWarnings: config.warnings,
    };
  }
}
