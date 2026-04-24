/**
 * E2E Tests for G8h - Primary Sub-Attribute Enforcement (RFC 7643 section 2.4)
 *
 * Validates the PrimaryEnforcement config flag behavior across all three modes:
 * - "normalize" (default): keep first primary=true, set rest to false
 * - "reject": return 400 invalidValue if >1 primary=true
 * - "passthrough": store as-is (no enforcement)
 */

import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import {
  scimPost,
  scimPut,
  scimPatch,
  createEndpointWithConfig,
  createEndpoint,
  scimBasePath,
} from './helpers/request.helper';
import {
  validUser,
  resetFixtureCounter,
} from './helpers/fixtures';

let app: INestApplication;
let token: string;

beforeAll(async () => {
  app = await createTestApp();
  token = await getAuthToken(app);
});

afterAll(async () => {
  await app.close();
});

// ─── normalize mode (default) ───────────────────────────────────────────────

describe('G8h: PrimaryEnforcement = normalize', () => {
  let endpointId: string;
  let basePath: string;

  beforeEach(async () => {
    resetFixtureCounter();
    endpointId = await createEndpointWithConfig(app, token, { PrimaryEnforcement: 'normalize' });
    basePath = scimBasePath(endpointId);
  });

  it('POST /Users with 2 primary emails should normalize to 1', async () => {
    const res = await scimPost(app, `${basePath}/Users`, token, validUser({
      emails: [
        { value: 'a@x.com', type: 'work', primary: true },
        { value: 'b@x.com', type: 'home', primary: true },
      ],
    })).expect(201);

    // First email keeps primary, second is cleared
    const emails = res.body.emails;
    expect(emails).toHaveLength(2);
    expect(emails[0].primary).toBe(true);
    expect(emails[1].primary).toBe(false);
  });

  it('PUT /Users with 2 primary phones should normalize to 1', async () => {
    // Create user first
    const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

    // PUT with duplicate primaries on phoneNumbers
    const putBody = validUser({
      userName: created.userName,
      phoneNumbers: [
        { value: '+1-555-0100', type: 'work', primary: true },
        { value: '+1-555-0200', type: 'home', primary: true },
      ],
    });
    const res = await scimPut(app, `${basePath}/Users/${created.id}`, token, putBody).expect(200);

    const phones = res.body.phoneNumbers;
    expect(phones).toHaveLength(2);
    expect(phones[0].primary).toBe(true);
    expect(phones[1].primary).toBe(false);
  });

  it('POST /Users with 0 primaries should pass through unchanged', async () => {
    const res = await scimPost(app, `${basePath}/Users`, token, validUser({
      emails: [
        { value: 'a@x.com', type: 'work' },
        { value: 'b@x.com', type: 'home' },
      ],
    })).expect(201);

    const emails = res.body.emails;
    expect(emails).toHaveLength(2);
    // primary should be undefined or not set (no mutation)
    expect(emails[0].primary).toBeFalsy();
    expect(emails[1].primary).toBeFalsy();
  });

  it('POST /Users with 1 primary should pass through unchanged', async () => {
    const res = await scimPost(app, `${basePath}/Users`, token, validUser({
      emails: [
        { value: 'a@x.com', type: 'work', primary: true },
        { value: 'b@x.com', type: 'home', primary: false },
      ],
    })).expect(201);

    const emails = res.body.emails;
    expect(emails[0].primary).toBe(true);
    expect(emails[1].primary).toBe(false);
  });

  it('cross-attribute: 1 primary email + 1 primary phone is valid', async () => {
    const res = await scimPost(app, `${basePath}/Users`, token, validUser({
      emails: [
        { value: 'a@x.com', type: 'work', primary: true },
      ],
      phoneNumbers: [
        { value: '+1-555-0100', type: 'work', primary: true },
      ],
    })).expect(201);

    // Both should retain their single primary - no conflict across attributes
    expect(res.body.emails[0].primary).toBe(true);
    expect(res.body.phoneNumbers[0].primary).toBe(true);
  });
});

// ─── reject mode ────────────────────────────────────────────────────────────

describe('G8h: PrimaryEnforcement = reject', () => {
  let endpointId: string;
  let basePath: string;

  beforeEach(async () => {
    resetFixtureCounter();
    endpointId = await createEndpointWithConfig(app, token, { PrimaryEnforcement: 'reject' });
    basePath = scimBasePath(endpointId);
  });

  it('POST /Users with 2 primary emails should return 400', async () => {
    const res = await scimPost(app, `${basePath}/Users`, token, validUser({
      emails: [
        { value: 'a@x.com', type: 'work', primary: true },
        { value: 'b@x.com', type: 'home', primary: true },
      ],
    })).expect(400);

    expect(res.body.scimType).toBe('invalidValue');
    expect(res.body.detail).toContain('primary');
    expect(res.body.detail).toContain('emails');
  });

  it('PATCH adding duplicate primaries should return 400', async () => {
    // Create user with one email
    const created = (await scimPost(app, `${basePath}/Users`, token, validUser({
      emails: [{ value: 'orig@x.com', type: 'work', primary: true }],
    })).expect(201)).body;

    // PATCH replace emails with 2 primaries
    const res = await scimPatch(app, `${basePath}/Users/${created.id}`, token, {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{
        op: 'replace',
        path: 'emails',
        value: [
          { value: 'a@x.com', type: 'work', primary: true },
          { value: 'b@x.com', type: 'home', primary: true },
        ],
      }],
    }).expect(400);

    expect(res.body.scimType).toBe('invalidValue');
    expect(res.body.detail).toContain('primary');
  });
});

// ─── passthrough mode ───────────────────────────────────────────────────────

describe('G8h: PrimaryEnforcement = passthrough', () => {
  let endpointId: string;
  let basePath: string;

  beforeEach(async () => {
    resetFixtureCounter();
    endpointId = await createEndpointWithConfig(app, token, { PrimaryEnforcement: 'passthrough' });
    basePath = scimBasePath(endpointId);
  });

  it('POST /Users with 2 primary emails should store both as-is', async () => {
    const res = await scimPost(app, `${basePath}/Users`, token, validUser({
      emails: [
        { value: 'a@x.com', type: 'work', primary: true },
        { value: 'b@x.com', type: 'home', primary: true },
      ],
    })).expect(201);

    const emails = res.body.emails;
    expect(emails).toHaveLength(2);
    expect(emails[0].primary).toBe(true);
    expect(emails[1].primary).toBe(true);
  });

  it('PATCH replacing emails with 2 primaries should store both as-is', async () => {
    // Create user first
    const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

    // PATCH replace emails with 2 primaries - passthrough stores as-is
    const res = await scimPatch(app, `${basePath}/Users/${created.id}`, token, {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{
        op: 'replace',
        path: 'emails',
        value: [
          { value: 'a@x.com', type: 'work', primary: true },
          { value: 'b@x.com', type: 'home', primary: true },
        ],
      }],
    }).expect(200);

    const emails = res.body.emails;
    expect(emails).toHaveLength(2);
    expect(emails[0].primary).toBe(true);
    expect(emails[1].primary).toBe(true);
  });
});

// ─── default mode (no flag set) ─────────────────────────────────────────────

describe('G8h: PrimaryEnforcement = default (not explicitly set)', () => {
  let endpointId: string;
  let basePath: string;

  beforeEach(async () => {
    resetFixtureCounter();
    // Create endpoint with 'minimal' preset which does NOT set PrimaryEnforcement.
    // Code default should be 'passthrough'.
    const request = await import('supertest');
    const res = await request.default(app.getHttpServer())
      .post('/scim/admin/endpoints')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ name: `e2e-default-primary-${Date.now()}`, profilePreset: 'minimal' })
      .expect(201);
    endpointId = res.body.id;
    basePath = scimBasePath(endpointId);

    // PATCH StrictSchemaValidation=False for backward compat (minimal defaults to true)
    await request.default(app.getHttpServer())
      .patch(`/scim/admin/endpoints/${endpointId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ profile: { settings: { StrictSchemaValidation: 'False' } } })
      .expect(200);
  });

  it('POST /Users with 2 primary emails should passthrough (default mode)', async () => {
    const res = await scimPost(app, `${basePath}/Users`, token, validUser({
      emails: [
        { value: 'a@x.com', type: 'work', primary: true },
        { value: 'b@x.com', type: 'home', primary: true },
      ],
    })).expect(201);

    // Default is passthrough - both primaries stored as-is
    const emails = res.body.emails;
    expect(emails).toHaveLength(2);
    expect(emails[0].primary).toBe(true);
    expect(emails[1].primary).toBe(true);
  });
});
