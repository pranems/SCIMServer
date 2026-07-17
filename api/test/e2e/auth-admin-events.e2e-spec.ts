/**
 * Auth observability Phase 4 - config-time auth audit events (E2E).
 *
 * Every config-time auth operation emits exactly ONE canonical
 * `LogCategory.AUTH` "Auth config change" event through the existing ring
 * buffer (queryable via GET /scim/admin/log-config/recent?category=auth), so an
 * operator can audit auth-administration activity alongside runtime auth
 * decisions. This spec locks the two entirely-new gap surfaces end-to-end:
 * the JWKS host allowlist and auth-affecting endpoint flag changes.
 *
 * @see docs/auth/AUTH_ERROR_DIAGNOSTICS_AND_OBSERVABILITY.md section 14a (P4)
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { createEndpoint } from './helpers/request.helper';

describe('Auth config change events (E2E) - Phase 4', () => {
  let app: INestApplication;
  let adminToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    adminToken = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  async function recentAuthEvents(): Promise<Array<Record<string, unknown>>> {
    const recent = await request(app.getHttpServer())
      .get('/scim/admin/log-config/recent?category=auth&limit=300')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    return (recent.body.entries as Array<Record<string, unknown>>).filter(
      (e) => e.message === 'Auth config change',
    );
  }

  it('a JWKS host add emits a jwks_host_add "Auth config change" event', async () => {
    const host = `idp-${Date.now()}.example.com`;
    await request(app.getHttpServer())
      .post('/scim/admin/settings/jwks-hosts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ host, label: 'p4-e2e' })
      .expect(201);

    const events = await recentAuthEvents();
    const hit = events.find(
      (e) => (e.data as Record<string, unknown>)?.action === 'jwks_host_add' &&
        (e.data as Record<string, unknown>)?.host === host,
    );
    expect(hit).toBeDefined();
    expect((hit!.data as Record<string, unknown>).outcome).toBe('success');

    // Cleanup - remove the host (also emits a jwks_host_remove event).
    await request(app.getHttpServer())
      .delete(`/scim/admin/settings/jwks-hosts/${host}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const afterRemove = await recentAuthEvents();
    expect(
      afterRemove.some(
        (e) => (e.data as Record<string, unknown>)?.action === 'jwks_host_remove' &&
          (e.data as Record<string, unknown>)?.host === host,
      ),
    ).toBe(true);
  });

  it('flipping an auth-affecting endpoint flag emits an auth_flags_changed event', async () => {
    const endpointId = await createEndpoint(app, adminToken);

    await request(app.getHttpServer())
      .patch(`/scim/admin/endpoints/${endpointId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ profile: { settings: { WifCredentialsEnabled: 'True' } } })
      .expect(200);

    const events = await recentAuthEvents();
    const hit = events.find(
      (e) => (e.data as Record<string, unknown>)?.action === 'auth_flags_changed' &&
        (e.data as Record<string, unknown>)?.endpointId === endpointId,
    );
    expect(hit).toBeDefined();
    const changedFlags = (hit!.data as Record<string, unknown>).changedFlags as Array<{ flag: string; to: unknown }>;
    expect(changedFlags.some((c) => c.flag === 'WifCredentialsEnabled')).toBe(true);
  });

  it('a non-auth setting change does NOT emit an auth_flags_changed event', async () => {
    const endpointId = await createEndpoint(app, adminToken);

    await request(app.getHttpServer())
      .patch(`/scim/admin/endpoints/${endpointId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ profile: { settings: { MultiMemberPatchOpForGroupEnabled: 'True' } } })
      .expect(200);

    const events = await recentAuthEvents();
    const hit = events.find(
      (e) => (e.data as Record<string, unknown>)?.action === 'auth_flags_changed' &&
        (e.data as Record<string, unknown>)?.endpointId === endpointId,
    );
    expect(hit).toBeUndefined();
  });
});
