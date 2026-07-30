import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  AuthDecisionRecordStore,
  type AuthDecisionQuery,
  type AuthDecisionRecord,
} from '../../../oauth/auth-decision-record.store';

interface AuthDecisionsResponse {
  count: number;
  records: AuthDecisionRecord[];
}

/**
 * WI-D5: the admin query surface for recent Auth Decision Records.
 *
 * Two scopes, mirroring the existing two-scope log API + the R4b
 * endpoint-vs-server precedent:
 *  - global:        GET /scim/admin/auth-decisions
 *  - per-endpoint:  GET /scim/admin/endpoints/:endpointId/auth-decisions
 *
 * Admin-only (the default bearer guard applies - no `@Public`). Short-TTL,
 * in-memory, decoded non-secret claims only (the raw assertion is never
 * stored). Supports `?outcome=`, `?reasonCode=`, and `?limit=` filters.
 */
@Controller('admin')
export class AuthDecisionsController {
  constructor(private readonly store: AuthDecisionRecordStore) {}

  /** Global scope - recent auth decisions across ALL endpoints. */
  @Get('auth-decisions')
  listGlobal(
    @Query('outcome') outcome?: string,
    @Query('reasonCode') reasonCode?: string,
    @Query('limit') limit?: string,
  ): AuthDecisionsResponse {
    return this.build(this.parseQuery({ outcome, reasonCode, limit }));
  }

  /** Per-endpoint scope - recent auth decisions for one endpoint. */
  @Get('endpoints/:endpointId/auth-decisions')
  listForEndpoint(
    @Param('endpointId') endpointId: string,
    @Query('outcome') outcome?: string,
    @Query('reasonCode') reasonCode?: string,
    @Query('limit') limit?: string,
  ): AuthDecisionsResponse {
    return this.build(this.parseQuery({ endpointId, outcome, reasonCode, limit }));
  }

  private parseQuery(raw: {
    endpointId?: string;
    outcome?: string;
    reasonCode?: string;
    limit?: string;
  }): AuthDecisionQuery {
    const q: AuthDecisionQuery = {};
    if (raw.endpointId) q.endpointId = raw.endpointId;
    if (raw.outcome === 'accept' || raw.outcome === 'reject') q.outcome = raw.outcome;
    if (raw.reasonCode) q.reasonCode = raw.reasonCode;
    if (raw.limit) {
      const n = parseInt(raw.limit, 10);
      if (Number.isFinite(n) && n > 0) q.limit = n;
    }
    return q;
  }

  private build(q: AuthDecisionQuery): AuthDecisionsResponse {
    const records = this.store.query(q);
    return { count: records.length, records };
  }
}
