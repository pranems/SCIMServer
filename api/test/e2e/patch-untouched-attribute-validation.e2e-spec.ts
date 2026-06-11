/**
 * Post-PATCH validation scoping - regression for the OpenText ISV-3 production
 * incident (endpoint 128f64b5-ffb5-41f2-9ba2-c874f5ea7335, calmsand prod).
 *
 * A PATCH that only targets `proxyAddresses` was rejected with
 *   "Schema validation failed: emails[0].primary: Unknown sub-attribute
 *    'primary' in complex attribute."
 * because post-PATCH strict validation re-validated the ENTIRE merged resource,
 * including pre-existing `emails` data that predates the endpoint's corrected
 * `emails` schema (which intentionally omits `primary`).
 *
 * Per RFC 7644 §3.5.2 a PATCH targets specific attributes; untouched attributes
 * are out of scope. Strict post-PATCH validation must therefore only consider
 * the attributes the operations actually touched.
 *
 * The custom User schema below defines `emails` WITHOUT a `primary` sub-attribute
 * and registers a Mailbox extension carrying `proxyAddresses` - faithfully
 * mirroring the production endpoint.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { scimGet, scimPost, scimPatch, scimBasePath } from './helpers/request.helper';

describe('Post-PATCH validation scoping (E2E)', () => {
  let app: INestApplication;
  let token: string;
  let endpointId: string;

  const CORE_USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
  const MAILBOX_URN = 'urn:opentext:scim:schemas:extension:mailbox:2.0:User';

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);

    // Create an endpoint whose User schema defines emails WITHOUT `primary`,
    // plus a Mailbox extension with multi-valued string `proxyAddresses`.
    // Start with StrictSchemaValidation OFF so pre-existing emails[].primary can
    // be stored (mirrors the production resource created before the correction).
    const res = await request(app.getHttpServer())
      .post('/scim/admin/endpoints')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({
        name: `patch-scope-${Date.now()}`,
        profile: {
          schemas: [
            {
              id: CORE_USER,
              name: 'User',
              attributes: [
                { name: 'userName', type: 'string', multiValued: false, required: true, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'server' },
                { name: 'displayName', type: 'string', multiValued: false, required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
                { name: 'active', type: 'boolean', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
                {
                  name: 'emails', type: 'complex', multiValued: true, required: false, mutability: 'readWrite', returned: 'default',
                  subAttributes: [
                    { name: 'value', type: 'string', multiValued: false, required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
                    { name: 'type', type: 'string', multiValued: false, required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
                    // NOTE: intentionally NO `primary` sub-attribute.
                  ],
                },
              ],
            },
            {
              id: MAILBOX_URN,
              name: 'Mailbox',
              attributes: [
                { name: 'proxyAddresses', type: 'string', multiValued: true, required: false, caseExact: true, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
              ],
            },
            { id: 'urn:ietf:params:scim:schemas:core:2.0:Group', name: 'Group', attributes: 'all' },
          ],
          resourceTypes: [
            {
              id: 'User', name: 'User', endpoint: '/Users', description: 'User',
              schema: CORE_USER,
              schemaExtensions: [{ schema: MAILBOX_URN, required: false }],
            },
            { id: 'Group', name: 'Group', endpoint: '/Groups', description: 'Group', schema: 'urn:ietf:params:scim:schemas:core:2.0:Group', schemaExtensions: [] },
          ],
          settings: { StrictSchemaValidation: 'False' },
        },
      })
      .expect(201);
    endpointId = res.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('a proxyAddresses-only PATCH succeeds despite pre-existing emails[].primary that the schema no longer allows', async () => {
    const basePath = scimBasePath(endpointId);

    // 1. Create a user with emails containing `primary` while strict is OFF, so
    //    the (now schema-invalid) sub-attribute is persisted in the raw payload.
    const created = (
      await scimPost(app, `${basePath}/Users`, token, {
        schemas: [CORE_USER, MAILBOX_URN],
        userName: `patch-scope-${Date.now()}@opentext.example.com`,
        emails: [{ value: 'primary@contoso.com', type: 'work', primary: true }],
        [MAILBOX_URN]: { proxyAddresses: ['SMTP:primary@contoso.com'] },
      }).expect(201)
    ).body;

    // 2. Tighten the endpoint to StrictSchemaValidation ON.
    await request(app.getHttpServer())
      .patch(`/scim/admin/endpoints/${endpointId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ profile: { settings: { StrictSchemaValidation: 'True' } } })
      .expect(200);

    // 3. PATCH only proxyAddresses (the production payload). This MUST NOT fail
    //    on the untouched, pre-existing emails[0].primary.
    const patchRes = await scimPatch(app, `${basePath}/Users/${created.id}`, token, {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [
        {
          op: 'replace',
          path: `${MAILBOX_URN}:proxyAddresses`,
          value: ['SMTP:updated@contoso.com', 'smtp:alias@contoso.com'],
        },
      ],
    });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body[MAILBOX_URN].proxyAddresses).toContain('SMTP:updated@contoso.com');
    expect(patchRes.body[MAILBOX_URN].proxyAddresses).toContain('smtp:alias@contoso.com');

    // The untouched emails are preserved as-is.
    expect(patchRes.body.emails[0].value).toBe('primary@contoso.com');
  });

  it('still rejects a PATCH that itself introduces an unknown sub-attribute on the touched attribute', async () => {
    const basePath = scimBasePath(endpointId);

    const created = (
      await scimPost(app, `${basePath}/Users`, token, {
        schemas: [CORE_USER],
        userName: `patch-scope-touch-${Date.now()}@opentext.example.com`,
      }).expect(201)
    ).body;

    // PATCH that DOES touch emails with the unknown `primary` sub-attribute must
    // still be rejected - the fix only excludes UNTOUCHED attributes.
    const patchRes = await scimPatch(app, `${basePath}/Users/${created.id}`, token, {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [
        { op: 'replace', path: 'emails', value: [{ value: 'x@y.com', type: 'work', primary: true }] },
      ],
    });

    expect(patchRes.status).toBe(400);
    const detail = String(patchRes.body.detail ?? '');
    expect(detail.toLowerCase()).toContain('primary');
  });
});
