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

  /**
   * A8 - adding or removing an authentication method is the most
   * security-sensitive config-time mutation the product exposes. It previously
   * emitted only free-text INFO, which cannot be alerted on or counted.
   */
  describe('A8 - authentication-method changes', () => {
    it('an add emits auth_method_add, and a remove emits auth_method_remove', async () => {
      const endpointId = await createEndpoint(app, adminToken);

      const created = await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/authentication/methods`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ type: 'wif-7523', displayName: 'A8 e2e' })
        .expect(201);
      const methodId = created.body.id as string;

      const added = (await recentAuthEvents()).find(
        (e) => (e.data as Record<string, unknown>)?.action === 'auth_method_add' &&
          (e.data as Record<string, unknown>)?.methodId === methodId,
      );
      expect(added).toBeDefined();
      expect((added!.data as Record<string, unknown>).outcome).toBe('success');
      expect((added!.data as Record<string, unknown>).endpointId).toBe(endpointId);
      expect((added!.data as Record<string, unknown>).method).toBe('wif-7523');

      await request(app.getHttpServer())
        .delete(`/scim/admin/endpoints/${endpointId}/authentication/methods/${methodId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      const removed = (await recentAuthEvents()).find(
        (e) => (e.data as Record<string, unknown>)?.action === 'auth_method_remove' &&
          (e.data as Record<string, unknown>)?.methodId === methodId,
      );
      expect(removed).toBeDefined();
      expect((removed!.data as Record<string, unknown>).outcome).toBe('success');
      expect((removed!.data as Record<string, unknown>).method).toBe('wif-7523');
    });

    it('a rejected method type emits a failure event rather than silence', async () => {
      const endpointId = await createEndpoint(app, adminToken);

      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/authentication/methods`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ type: 'definitely-not-a-method' })
        .expect(400);

      const hit = (await recentAuthEvents()).find(
        (e) => (e.data as Record<string, unknown>)?.action === 'auth_method_add' &&
          (e.data as Record<string, unknown>)?.endpointId === endpointId &&
          (e.data as Record<string, unknown>)?.outcome === 'failure',
      );
      expect(hit).toBeDefined();
    });

    it('the emitted event carries no secret-bearing config', async () => {
      const endpointId = await createEndpoint(app, adminToken);

      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/authentication/methods`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ type: 'oauth-client', config: { clientSecret: 'e2e-planted-secret', issuer: 'https://example.test' } })
        .expect(201);

      const mine = (await recentAuthEvents()).filter(
        (e) => (e.data as Record<string, unknown>)?.endpointId === endpointId,
      );
      expect(mine.length).toBeGreaterThan(0);
      expect(JSON.stringify(mine)).not.toContain('e2e-planted-secret');
      expect(JSON.stringify(mine)).not.toContain('clientSecret');
    });
  });
});


