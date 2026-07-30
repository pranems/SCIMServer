import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { scimPost, scimBasePath } from './helpers/request.helper';
import { resetFixtureCounter } from './helpers/fixtures';

/**
 * RfcCompliantSubAttributes - E2E.
 *
 * Proves the flag end to end over real HTTP across the full 2x2 of
 * (RfcCompliantSubAttributes x StrictSchemaValidation), because the flag is
 * STANDALONE: it must fire even when StrictSchemaValidation is OFF.
 *
 * Two RFC 7643 rules ride on one flag, in OPPOSITE directions:
 *   R1  section 2.3.8 - a complex attribute MUST NOT contain complex
 *       sub-attributes. Erratum 8415 (Verified 2025-10-28).
 *   R2  section 1.2 - a sub-attribute MAY be multi-valued while staying simple.
 *       Erratum 5607 (Verified).
 *
 * Every assertion here checks a RENDERED OUTCOME (status + scimType + the
 * attribute path named in the diagnostics envelope, or the persisted value
 * round-tripping), never merely that a field exists.
 *
 * @see docs/rfcs/SCIM_SUBATTRIBUTE_TYPE_RULES.md
 * @see docs/ENDPOINT_CONFIG_FLAGS_REFERENCE.md
 */
const CORE_USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
const DIAG = 'urn:scimserver:api:messages:2.0:Diagnostics';

/** R1: `geo` is complex INSIDE a complex attribute - forbidden by section 2.3.8. */
const addressAttr = {
  name: 'address', type: 'complex', multiValued: false, required: false, mutability: 'readWrite', returned: 'default',
  subAttributes: [
    { name: 'street', type: 'string', multiValued: false, required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
    {
      name: 'geo', type: 'complex', multiValued: false, required: false, mutability: 'readWrite', returned: 'default',
      subAttributes: [
        { name: 'lat', type: 'decimal', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
        { name: 'lon', type: 'decimal', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
      ],
    },
  ],
};

/** R2: `skus` is multi-valued but SIMPLE - legal per section 1.2. */
const licensesAttr = {
  name: 'licenses', type: 'complex', multiValued: true, required: false, mutability: 'readWrite', returned: 'default',
  subAttributes: [
    { name: 'value', type: 'string', multiValued: false, required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
    { name: 'skus', type: 'string', multiValued: true, required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
  ],
};

async function createEndpoint(app: INestApplication, token: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/scim/admin/endpoints')
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/json')
    .send({ name: `rfc-subattr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` })
    .expect(201);
  return res.body.id as string;
}

/**
 * APPEND the two test attributes to the endpoint's EXISTING core User schema.
 *
 * Sending `profile.schemas` replaces the array wholesale, which orphans every
 * ResourceType -> schema reference and the profile validator correctly rejects
 * it with 400. Read-modify-write is the only shape that keeps the profile
 * internally consistent.
 */
async function configure(
  app: INestApplication,
  token: string,
  endpointId: string,
  settings: Record<string, unknown>,
): Promise<void> {
  const current = await request(app.getHttpServer())
    .get(`/scim/admin/endpoints/${endpointId}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  const schemas = JSON.parse(JSON.stringify(current.body.profile.schemas)) as Array<{
    id: string;
    attributes: unknown[];
  }>;
  const userSchema = schemas.find(s => s.id === CORE_USER);
  if (!userSchema) {
    throw new Error(`core User schema not present on endpoint profile: ${schemas.map(s => s.id).join(', ')}`);
  }
  userSchema.attributes.push(addressAttr, licensesAttr);

  const res = await request(app.getHttpServer())
    .patch(`/scim/admin/endpoints/${endpointId}`)
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/json')
    .send({ profile: { schemas, settings } });

  if (res.status !== 200) {
    throw new Error(`admin PATCH failed ${res.status}: ${JSON.stringify(res.body).slice(0, 900)}`);
  }
}

/**
 * The stock endpoint profile marks `displayName` and `emails` REQUIRED, so
 * every payload here must carry them. Omitting them produced a 400 for an
 * unrelated reason and would have let a test asserting 400 pass for the wrong
 * reason entirely.
 */
const baseUser = (suffix: string) => ({
  schemas: [CORE_USER],
  userName: `${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`,
  displayName: `subattr ${suffix}`,
  emails: [{ value: `${suffix}@example.com`, type: 'work', primary: true }],
});

const nestedUser = (suffix: string) => ({
  ...baseUser(suffix),
  address: { street: '1 Main St', geo: { lat: 47.6, lon: -122.3 } },
});

/**
 * Assert a status AND surface the SCIM error body when it does not match.
 *
 * supertest's `.expect(201)` only reports "expected 201, got 400", which is
 * useless here: a 400 could be the 2.3.8 rejection under test, or an unrelated
 * "unknown attribute" rejection. Without the body, a test asserting 400 can
 * pass for entirely the wrong reason.
 */
function expectStatus(res: request.Response, expected: number): request.Response {
  if (res.status !== expected) {
    throw new Error(
      `expected ${expected}, got ${res.status}\nbody: ${JSON.stringify(res.body).slice(0, 900)}`,
    );
  }
  return res;
}

describe('RfcCompliantSubAttributes (E2E)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => resetFixtureCounter());

  // ─── Flag OFF: current behavior, both strict states ───────────────────────

  describe('flag OFF (default) - current behavior is preserved', () => {
    it('strict ON: accepts a payload populating a complex sub-attribute (201)', async () => {
      const id = await createEndpoint(app, token);
      await configure(app, token, id, { StrictSchemaValidation: true, RfcCompliantSubAttributes: false });

      const res = expectStatus(
        await scimPost(app, `${scimBasePath(id)}/Users`, token, nestedUser('off-strict')),
        201,
      );
      expect(res.body.address.geo.lat).toBe(47.6);
    });

    it('strict OFF: accepts it too (201)', async () => {
      const id = await createEndpoint(app, token);
      await configure(app, token, id, { StrictSchemaValidation: false, RfcCompliantSubAttributes: false });

      expectStatus(
        await scimPost(app, `${scimBasePath(id)}/Users`, token, nestedUser('off-lenient')),
        201,
      );
    });
  });

  // ─── Flag ON + R1: rejected regardless of strict mode ─────────────────────

  describe('flag ON - R1 rejects complex sub-attributes (section 2.3.8)', () => {
    it('strict ON: 400 invalidValue naming address.geo and citing 2.3.8', async () => {
      const id = await createEndpoint(app, token);
      await configure(app, token, id, { StrictSchemaValidation: true, RfcCompliantSubAttributes: true });

      const res = expectStatus(
        await scimPost(app, `${scimBasePath(id)}/Users`, token, nestedUser('on-strict')),
        400,
      );

      expect(res.body.scimType).toBe('invalidValue');
      expect(res.body.detail).toContain('2.3.8');
      expect(res.body[DIAG]?.attributePaths).toContain('address.geo');
      // The payload is otherwise VALID, so 2.3.8 must be the ONLY complaint.
      // Without this the test would pass even if the 400 were mostly noise.
      expect(res.body[DIAG]?.attributePaths).toEqual(['address.geo']);
      // The rejection must be attributed to the flag that CAUSED it. Blaming
      // StrictSchemaValidation here would send an operator to the wrong
      // switch, because turning strict off does not lift this rejection
      // (proved by the STANDALONE test below). Found by the Playwright spec.
      expect(res.body[DIAG]?.triggeredBy).toBe('RfcCompliantSubAttributes');
      expect(res.body[DIAG]?.activeConfig).toMatchObject({
        StrictSchemaValidation: true,
        RfcCompliantSubAttributes: true,
      });
    });

    it('STANDALONE: strict OFF still rejects with 400 (the flag is not gated on strict)', async () => {
      const id = await createEndpoint(app, token);
      await configure(app, token, id, { StrictSchemaValidation: false, RfcCompliantSubAttributes: true });

      const res = expectStatus(
        await scimPost(app, `${scimBasePath(id)}/Users`, token, nestedUser('on-lenient')),
        400,
      );

      expect(res.body.scimType).toBe('invalidValue');
      expect(res.body.detail).toContain('2.3.8');
      expect(res.body[DIAG]?.attributePaths).toEqual(['address.geo']);
      expect(res.body[DIAG]?.triggeredBy).toBe('RfcCompliantSubAttributes');
    });

    it('strict OFF: does NOT start rejecting unknown attributes (strict stays off)', async () => {
      const id = await createEndpoint(app, token);
      await configure(app, token, id, { StrictSchemaValidation: false, RfcCompliantSubAttributes: true });

      // No R1 violation here, but an attribute the schema never declared.
      // A lenient endpoint must still accept it - otherwise the flag has
      // silently turned strict mode on, which is a far larger change.
      expectStatus(
        await scimPost(app, `${scimBasePath(id)}/Users`, token, {
          ...baseUser('unknown-attr'),
          somethingUndeclared: 'tolerated',
        }),
        201,
      );
    });

    it('accepts a payload that omits the offending sub-attribute (201)', async () => {
      const id = await createEndpoint(app, token);
      await configure(app, token, id, { StrictSchemaValidation: true, RfcCompliantSubAttributes: true });

      const res = expectStatus(
        await scimPost(app, `${scimBasePath(id)}/Users`, token, {
          ...baseUser('no-geo'),
          address: { street: '1 Main St' },
        }),
        201,
      );

      expect(res.body.address.street).toBe('1 Main St');
    });
  });

  // ─── Flag ON + R2: multi-valued SIMPLE sub-attributes honoured ────────────

  describe('flag ON - R2 honours multi-valued simple sub-attributes (section 1.2)', () => {
    it('strict ON: accepts an array of primitives and round-trips it (201)', async () => {
      const id = await createEndpoint(app, token);
      await configure(app, token, id, { StrictSchemaValidation: true, RfcCompliantSubAttributes: true });

      const res = expectStatus(
        await scimPost(app, `${scimBasePath(id)}/Users`, token, {
          ...baseUser('skus'),
          licenses: [{ value: 'E5', skus: ['EXCHANGE', 'TEAMS'] }],
        }),
        201,
      );

      expect(res.body.licenses[0].skus).toEqual(['EXCHANGE', 'TEAMS']);
    });

    it('strict ON with the flag OFF: the same payload is REJECTED (legacy behavior)', async () => {
      const id = await createEndpoint(app, token);
      await configure(app, token, id, { StrictSchemaValidation: true, RfcCompliantSubAttributes: false });

      const res = expectStatus(
        await scimPost(app, `${scimBasePath(id)}/Users`, token, {
          ...baseUser('skus-legacy'),
          licenses: [{ value: 'E5', skus: ['EXCHANGE', 'TEAMS'] }],
        }),
        400,
      );

      expect(res.body[DIAG]?.attributePaths).toContain('licenses[0].skus');
    });

    it('still type-checks each element and names the offending index', async () => {
      const id = await createEndpoint(app, token);
      await configure(app, token, id, { StrictSchemaValidation: true, RfcCompliantSubAttributes: true });

      const res = expectStatus(
        await scimPost(app, `${scimBasePath(id)}/Users`, token, {
          ...baseUser('skus-bad'),
          licenses: [{ value: 'E5', skus: ['EXCHANGE', 42] }],
        }),
        400,
      );

      expect(res.body[DIAG]?.attributePaths).toContain('licenses[0].skus[1]');
    });
  });
});
