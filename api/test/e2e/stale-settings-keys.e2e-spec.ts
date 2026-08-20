/**
 * Retired settings keys must not survive on a profile (E2E).
 *
 * settings-v8 retired six flags. Three were RENAMED and are normalized by
 * `normalizeStaleSettingsKeys`; the rest were DERIVED away. Until now that
 * normalizer had no test at any level, and `CustomResourceTypesEnabled` was
 * never added to it - which is why it was still sitting on live endpoints
 * long after the server stopped reading it.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { createEndpoint } from './helpers/request.helper';

describe('retired settings keys (E2E)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  const patchSettings = (id: string, settings: Record<string, unknown>) =>
    request(app.getHttpServer())
      .patch(`/scim/admin/endpoints/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ profile: { settings } });

  const readSettings = async (id: string) => {
    const res = await request(app.getHttpServer())
      .get(`/scim/admin/endpoints/${id}?view=full`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body.profile.settings as Record<string, unknown>;
  };

  it('B-E1: CustomResourceTypesEnabled is dropped - it was derived away, not renamed', async () => {
    const id = await createEndpoint(app, token);
    await patchSettings(id, { CustomResourceTypesEnabled: 'True' }).expect(200);

    const settings = await readSettings(id);
    expect(settings).not.toHaveProperty('CustomResourceTypesEnabled');
  });

  it('B-E2: dropping it does not invent a replacement key', async () => {
    const id = await createEndpoint(app, token);
    await patchSettings(id, { CustomResourceTypesEnabled: 'True' }).expect(200);

    // Availability comes from profile.resourceTypes, so there is no successor
    // flag; a rename here would recreate the two-sources-of-truth problem.
    const settings = await readSettings(id);
    const suspicious = Object.keys(settings).filter((k) => /customresourcetype/i.test(k));
    expect(suspicious).toEqual([]);
  });

  it('B-E3: SoftDeleteEnabled is RENAMED to UserSoftDeleteEnabled, carrying its value', async () => {
    const id = await createEndpoint(app, token);
    await patchSettings(id, { SoftDeleteEnabled: true }).expect(200);

    const settings = await readSettings(id);
    expect(settings).not.toHaveProperty('SoftDeleteEnabled');
    expect(settings.UserSoftDeleteEnabled).toBe(true);
  });

  it('B-E4: a rename never overwrites an explicit modern value', async () => {
    const id = await createEndpoint(app, token);
    await patchSettings(id, { SoftDeleteEnabled: true, UserSoftDeleteEnabled: false }).expect(200);

    // The operator stated the modern key; the legacy alias must not win.
    const settings = await readSettings(id);
    expect(settings.UserSoftDeleteEnabled).toBe(false);
    expect(settings).not.toHaveProperty('SoftDeleteEnabled');
  });

  it('B-E5: the multi-member PATCH aliases both fold into one modern key', async () => {
    const id = await createEndpoint(app, token);
    await patchSettings(id, { MultiOpPatchRequestAddMultipleMembersToGroup: true }).expect(200);

    const settings = await readSettings(id);
    expect(settings).not.toHaveProperty('MultiOpPatchRequestAddMultipleMembersToGroup');
    expect(settings.MultiMemberPatchOpForGroupEnabled).toBe(true);
  });

  it('B-E6 (control): a live flag is untouched by the normalizer', async () => {
    const id = await createEndpoint(app, token);
    await patchSettings(id, { StrictSchemaValidation: false }).expect(200);

    const settings = await readSettings(id);
    expect(settings.StrictSchemaValidation).toBe(false);
  });
});
