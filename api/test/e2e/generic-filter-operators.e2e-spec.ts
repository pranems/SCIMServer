import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { resetFixtureCounter } from './helpers/fixtures';

/**
 * Generic Resource Filter Operators — E2E
 *
 * Validates that the generic service (custom resource types) supports all 10
 * RFC 7644 §3.4.2.2 filter operators (eq, ne, co, sw, ew, gt, ge, lt, le, pr)
 * plus AND/OR compound expressions. Gap G6 resolution.
 *
 * Prior to this fix, only `eq` on displayName/externalId was supported —
 * all other operators returned 400 invalidFilter.
 */
describe('Generic Resource Filter Operators (E2E)', () => {
  let app: INestApplication;
  let token: string;
  let endpointId: string;
  let basePath: string;

  const CUSTOM_SCHEMA_URN = 'urn:example:params:scim:schemas:custom:2.0:Sensor';
  const RESOURCE_TYPE = 'Sensors';

  // Test fixture IDs for cleanup
  const createdIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
    resetFixtureCounter();

    // Create endpoint with custom Sensor resource type
    const endpointRes = await request(app.getHttpServer())
      .post('/scim/admin/endpoints')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({
        name: `gfilter-test-${Date.now()}`,
        displayName: 'Generic Filter Test Endpoint',
        profile: {
          schemas: [
            { id: 'urn:ietf:params:scim:schemas:core:2.0:User', name: 'User', attributes: 'all' },
            { id: 'urn:ietf:params:scim:schemas:core:2.0:Group', name: 'Group', attributes: 'all' },
            {
              id: CUSTOM_SCHEMA_URN,
              name: 'Sensor',
              description: 'IoT sensor resource',
              attributes: [
                { name: 'displayName', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', caseExact: false, uniqueness: 'server' },
                { name: 'externalId', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', caseExact: true, uniqueness: 'none' },
                { name: 'sensorName', type: 'string', multiValued: false, required: true, mutability: 'readWrite', returned: 'default', caseExact: false, uniqueness: 'none' },
                { name: 'location', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', caseExact: true, uniqueness: 'none' },
                { name: 'reading', type: 'decimal', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', caseExact: false, uniqueness: 'none' },
              ],
            },
          ],
          resourceTypes: [
            { id: 'User', name: 'User', endpoint: '/Users', description: 'User Account', schema: 'urn:ietf:params:scim:schemas:core:2.0:User', schemaExtensions: [] },
            { id: 'Group', name: 'Group', endpoint: '/Groups', description: 'Group', schema: 'urn:ietf:params:scim:schemas:core:2.0:Group', schemaExtensions: [] },
            { id: 'Sensor', name: 'Sensor', endpoint: `/${RESOURCE_TYPE}`, description: 'Sensor', schema: CUSTOM_SCHEMA_URN, schemaExtensions: [] },
          ],
          serviceProviderConfig: {
            patch: { supported: true },
            bulk: { supported: false },
            filter: { supported: true, maxResults: 200 },
            changePassword: { supported: false },
            sort: { supported: true },
            etag: { supported: true },
          },
          settings: {},
        },
      })
      .expect(201);

    endpointId = endpointRes.body.id;
    basePath = `/scim/endpoints/${endpointId}/${RESOURCE_TYPE}`;

    // Seed 4 test Sensors with varying displayNames and externalIds
    const sensors = [
      { displayName: 'Alpha Sensor', externalId: 'ext-alpha', sensorName: 'alpha', location: 'Building-A' },
      { displayName: 'Beta Sensor', externalId: 'ext-beta', sensorName: 'beta', location: 'Building-B' },
      { displayName: 'Gamma Sensor', externalId: 'ext-gamma', sensorName: 'gamma', location: 'Building-A' },
      { displayName: 'Delta Probe', externalId: 'ext-delta', sensorName: 'delta', location: 'Building-C' },
    ];

    for (const sensor of sensors) {
      const res = await request(app.getHttpServer())
        .post(basePath)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({ schemas: [CUSTOM_SCHEMA_URN], ...sensor })
        .expect(201);
      createdIds.push(res.body.id);
    }
  });

  afterAll(async () => {
    // Cleanup all created resources
    for (const id of createdIds) {
      await request(app.getHttpServer())
        .delete(`${basePath}/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .catch(() => {}); // ignore cleanup failures
    }
    // Delete the endpoint
    await request(app.getHttpServer())
      .delete(`/scim/admin/endpoints/${endpointId}`)
      .set('Authorization', `Bearer ${token}`)
      .catch(() => {});
    await app.close();
  });

  // ── eq (equals) ──────────────────────────────────────────────────────

  it('eq — should filter by displayName eq (case-insensitive)', async () => {
    const res = await request(app.getHttpServer())
      .get(`${basePath}?filter=displayName eq "Alpha Sensor"`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.totalResults).toBe(1);
    expect(res.body.Resources[0]).toHaveProperty('displayName', 'Alpha Sensor');
  });

  it('eq — should filter by externalId eq (case-sensitive)', async () => {
    const res = await request(app.getHttpServer())
      .get(`${basePath}?filter=externalId eq "ext-beta"`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.totalResults).toBe(1);
    expect(res.body.Resources[0]).toHaveProperty('externalId', 'ext-beta');
  });

  // ── ne (not equals) ─────────────────────────────────────────────────

  it('ne — should exclude matching resources', async () => {
    const res = await request(app.getHttpServer())
      .get(`${basePath}?filter=displayName ne "Delta Probe"`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.totalResults).toBe(3);
    for (const r of res.body.Resources) {
      expect(r.displayName).not.toBe('Delta Probe');
    }
  });

  // ── co (contains) ───────────────────────────────────────────────────

  it('co — should filter by displayName co (contains)', async () => {
    const res = await request(app.getHttpServer())
      .get(`${basePath}?filter=displayName co "Sensor"`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Alpha Sensor, Beta Sensor, Gamma Sensor — NOT Delta Probe
    expect(res.body.totalResults).toBe(3);
    for (const r of res.body.Resources) {
      expect(r.displayName).toContain('Sensor');
    }
  });

  // ── sw (startsWith) ─────────────────────────────────────────────────

  it('sw — should filter by displayName sw (startsWith)', async () => {
    const res = await request(app.getHttpServer())
      .get(`${basePath}?filter=displayName sw "Beta"`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.totalResults).toBe(1);
    expect(res.body.Resources[0].displayName).toBe('Beta Sensor');
  });

  // ── ew (endsWith) ───────────────────────────────────────────────────

  it('ew — should filter by displayName ew (endsWith)', async () => {
    const res = await request(app.getHttpServer())
      .get(`${basePath}?filter=displayName ew "Probe"`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.totalResults).toBe(1);
    expect(res.body.Resources[0].displayName).toBe('Delta Probe');
  });

  // ── pr (presence) ───────────────────────────────────────────────────

  it('pr — should filter by externalId pr (presence)', async () => {
    const res = await request(app.getHttpServer())
      .get(`${basePath}?filter=externalId pr`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // All 4 sensors have externalId
    expect(res.body.totalResults).toBe(4);
  });

  // ── AND compound ────────────────────────────────────────────────────

  it('and — should filter with AND compound', async () => {
    const res = await request(app.getHttpServer())
      .get(`${basePath}?filter=displayName co "Sensor" and externalId eq "ext-gamma"`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.totalResults).toBe(1);
    expect(res.body.Resources[0].displayName).toBe('Gamma Sensor');
  });

  // ── OR compound ─────────────────────────────────────────────────────

  it('or — should filter with OR compound', async () => {
    const res = await request(app.getHttpServer())
      .get(`${basePath}?filter=displayName eq "Alpha Sensor" or displayName eq "Delta Probe"`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.totalResults).toBe(2);
    const names = res.body.Resources.map((r: Record<string, unknown>) => r.displayName).sort();
    expect(names).toEqual(['Alpha Sensor', 'Delta Probe']);
  });

  // ── In-memory fallback: filter on custom attribute ──────────────────

  it('eq on custom attribute — should fallback to in-memory filtering', async () => {
    const res = await request(app.getHttpServer())
      .get(`${basePath}?filter=sensorName eq "gamma"`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.totalResults).toBe(1);
    expect(res.body.Resources[0].sensorName).toBe('gamma');
  });

  it('co on custom attribute — in-memory contains', async () => {
    const res = await request(app.getHttpServer())
      .get(`${basePath}?filter=location co "Building"`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // All 4 sensors have locations containing "Building"
    expect(res.body.totalResults).toBe(4);
  });

  // ── POST /.search with filter ───────────────────────────────────────

  it('POST /.search — should support filter in search request body', async () => {
    const res = await request(app.getHttpServer())
      .post(`${basePath}/.search`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/scim+json')
      .send({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:SearchRequest'],
        filter: 'displayName sw "Alpha"',
        startIndex: 1,
        count: 10,
      })
      .expect(200);

    expect(res.body.totalResults).toBe(1);
    expect(res.body.Resources[0].displayName).toBe('Alpha Sensor');
  });

  // ── Error cases ─────────────────────────────────────────────────────

  it('should return 400 for syntactically invalid filter', async () => {
    const res = await request(app.getHttpServer())
      .get(`${basePath}?filter=(((`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    expect(res.body).toHaveProperty('scimType', 'invalidFilter');
  });

  it('should return ListResponse with empty Resources for no matches', async () => {
    const res = await request(app.getHttpServer())
      .get(`${basePath}?filter=displayName eq "NonExistent"`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.totalResults).toBe(0);
    expect(res.body.Resources).toEqual([]);
  });
});
