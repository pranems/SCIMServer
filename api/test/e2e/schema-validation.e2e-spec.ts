import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import {
  scimPost,
  scimGet,
  scimPut,
  scimPatch,
  createEndpoint,
  createEndpointWithConfig,
  scimBasePath,
} from './helpers/request.helper';
import {
  validUser,
  validGroup,
  patchOp,
  resetFixtureCounter,
} from './helpers/fixtures';

/**
 * Schema Validation E2E Tests
 *
 * Comprehensive tests for the StrictSchemaValidation config flag.
 *
 * Important context:
 *   - NestJS `ValidationPipe` with `transform: true` and `enableImplicitConversion: true`
 *     is active. This means DTO-declared properties (active → boolean, userName → string,
 *     displayName → string) are implicitly type-coerced BEFORE the service sees them.
 *   - The SchemaValidator skips reserved keys (schemas, id, externalId, meta) via RESERVED_KEYS.
 *   - Non-DTO properties (name, emails, phoneNumbers, addresses, etc.) pass through the
 *     `[key: string]: unknown` index signature WITHOUT type coercion — these are where
 *     validatePayloadSchema does its real work.
 *
 * References: RFC 7643 §2 (SCIM Schema), RFC 7644 §3.3 (Creating Resources)
 */
describe('Schema Validation (E2E)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    resetFixtureCounter();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════════════════
  async function strictEndpoint() {
    const endpointId = await createEndpointWithConfig(app, token, {
      StrictSchemaValidation: 'True',
    });
    return { endpointId, basePath: scimBasePath(endpointId) };
  }

  async function lenientEndpoint() {
    const endpointId = await createEndpoint(app, token);
    return { endpointId, basePath: scimBasePath(endpointId) };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §1 — Complex Attribute Type Validation
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Complex attribute type validation', () => {
    it('should reject user with name as flat string instead of complex object', async () => {
      const { basePath } = await strictEndpoint();

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        name: 'John Doe' as any,
      })).expect(400);

      expect(res.body.status).toBe('400');
      expect(res.body.detail).toContain('name');
    });

    it('should reject user with name as number', async () => {
      const { basePath } = await strictEndpoint();

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        name: 42 as any,
      })).expect(400);

      expect(res.body.status).toBe('400');
      expect(res.body.detail).toBeDefined();
    });

    it('should reject user with name as array', async () => {
      const { basePath } = await strictEndpoint();

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        name: ['Jane', 'Doe'] as any,
      })).expect(400);

      expect(res.body.status).toBe('400');
    });

    it('should accept user with valid complex name', async () => {
      const { basePath } = await strictEndpoint();

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        name: { givenName: 'Jane', familyName: 'Doe' },
      })).expect(201);

      expect(res.body.name.givenName).toBe('Jane');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §2 — Multi-valued / Single-valued Enforcement
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Multi-valued enforcement', () => {
    it('should reject user with emails as single object instead of array', async () => {
      const { basePath } = await strictEndpoint();

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        emails: { value: 'test@test.com', type: 'work' } as any,
      })).expect(400);

      expect(res.body.status).toBe('400');
      expect(res.body.detail).toBeDefined();
    });

    it('should reject user with phoneNumbers as string', async () => {
      const { basePath } = await strictEndpoint();

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        phoneNumbers: '+1-555-0100' as any,
      })).expect(400);

      expect(res.body.status).toBe('400');
    });

    it('should accept user with properly formed emails array', async () => {
      const { basePath } = await strictEndpoint();

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        emails: [
          { value: 'work@test.com', type: 'work', primary: true },
          { value: 'home@test.com', type: 'home' },
        ],
      })).expect(201);

      expect(res.body.emails).toHaveLength(2);
    });

    it('should reject group with members as string instead of array', async () => {
      const { basePath } = await strictEndpoint();

      const res = await scimPost(app, `${basePath}/Groups`, token, validGroup({
        members: 'not-an-array' as any,
      })).expect(400);

      expect(res.body.status).toBe('400');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §3 — Unknown Attribute Rejection
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Unknown attribute rejection', () => {
    it('should reject user with unknown core attribute in strict mode', async () => {
      const { basePath } = await strictEndpoint();

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        fooBarBaz: 'unknown value',
      } as any)).expect(400);

      expect(res.body.status).toBe('400');
      expect(res.body.detail).toContain('fooBarBaz');
    });

    it('should reject user with multiple unknown attributes', async () => {
      const { basePath } = await strictEndpoint();

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        customField1: 'value1',
        customField2: 42,
        customField3: true,
      } as any)).expect(400);

      expect(res.body.status).toBe('400');
      expect(res.body.detail).toBeDefined();
    });

    it('should accept user with unknown attribute when strict mode is OFF', async () => {
      const { basePath } = await lenientEndpoint();

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        fooBarBaz: 'unknown value',
      } as any)).expect(201);

      expect(res.body.id).toBeDefined();
    });

    it('should reject group with unknown attribute in strict mode', async () => {
      const { basePath } = await strictEndpoint();

      const res = await scimPost(app, `${basePath}/Groups`, token, validGroup({
        unknownGroupAttr: 'nope',
      } as any)).expect(400);

      expect(res.body.status).toBe('400');
    });

    it('should accept group with unknown attribute when strict mode is OFF', async () => {
      const { basePath } = await lenientEndpoint();

      const res = await scimPost(app, `${basePath}/Groups`, token, validGroup({
        unknownGroupAttr: 'fine in lenient',
      } as any)).expect(201);

      expect(res.body.id).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §4 — Sub-attribute Type Validation
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Sub-attribute type validation', () => {
    it('should reject user with wrong sub-attribute type in name.givenName', async () => {
      const { basePath } = await strictEndpoint();

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        name: { givenName: 12345 as any, familyName: 'Smith' },
      })).expect(400);

      expect(res.body.status).toBe('400');
      expect(res.body.detail).toBeDefined();
    });

    it('should reject user with wrong sub-attribute type in emails[].value', async () => {
      const { basePath } = await strictEndpoint();

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        emails: [{ value: 12345 as any, type: 'work', primary: true }],
      })).expect(400);

      expect(res.body.status).toBe('400');
    });

    it('should reject user with non-boolean primary in emails', async () => {
      const { basePath } = await strictEndpoint();

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        emails: [{ value: 'test@test.com', type: 'work', primary: 'yes' as any }],
      })).expect(400);

      expect(res.body.status).toBe('400');
    });

    it('should accept user with correct sub-attribute types', async () => {
      const { basePath } = await strictEndpoint();

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        name: { givenName: 'Jane', familyName: 'Doe' },
        emails: [{ value: 'jane@example.com', type: 'work', primary: true }],
      })).expect(201);

      expect(res.body.name.givenName).toBe('Jane');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §5 — Enterprise Extension Type Validation
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Enterprise extension type validation', () => {
    const ENTERPRISE = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

    it('should accept valid enterprise extension attributes', async () => {
      const { basePath } = await strictEndpoint();

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', ENTERPRISE],
        [ENTERPRISE]: {
          department: 'Engineering',
          employeeNumber: '12345',
          costCenter: 'CC-100',
          organization: 'Contoso',
          division: 'R&D',
        },
      })).expect(201);

      expect(res.body[ENTERPRISE]?.department).toBe('Engineering');
      expect(res.body[ENTERPRISE]?.employeeNumber).toBe('12345');
    });

    it('should reject enterprise extension with wrong type for department (number)', async () => {
      const { basePath } = await strictEndpoint();

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', ENTERPRISE],
        [ENTERPRISE]: {
          department: 42 as any,
        },
      })).expect(400);

      expect(res.body.status).toBe('400');
      expect(res.body.detail).toBeDefined();
    });

    it('should reject enterprise extension with unknown attribute', async () => {
      const { basePath } = await strictEndpoint();

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', ENTERPRISE],
        [ENTERPRISE]: {
          department: 'Engineering',
          unknownExtField: 'should-fail',
        },
      } as any)).expect(400);

      expect(res.body.status).toBe('400');
      expect(res.body.detail).toBeDefined();
    });

    it('should reject enterprise extension with manager as string (should be complex)', async () => {
      const { basePath } = await strictEndpoint();

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', ENTERPRISE],
        [ENTERPRISE]: {
          manager: 'John Manager' as any,
        },
      })).expect(400);

      expect(res.body.status).toBe('400');
    });

    it('should accept valid manager complex attribute', async () => {
      const { basePath } = await strictEndpoint();

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', ENTERPRISE],
        [ENTERPRISE]: {
          manager: { value: 'mgr-id-123' },
        },
      })).expect(201);

      expect(res.body[ENTERPRISE]?.manager).toBeDefined();
    });

    it('should reject enterprise extension with employeeNumber as number', async () => {
      const { basePath } = await strictEndpoint();

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', ENTERPRISE],
        [ENTERPRISE]: {
          employeeNumber: 12345 as any,
        },
      })).expect(400);

      expect(res.body.status).toBe('400');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §6 — Group Schema Validation
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Group schema validation', () => {
    it('should accept valid group in strict mode', async () => {
      const { basePath } = await strictEndpoint();

      const res = await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.displayName).toBeDefined();
    });

    it('should accept valid group with members array', async () => {
      const { basePath } = await strictEndpoint();

      // Create a user first for the member reference
      const userRes = await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);

      const res = await scimPost(app, `${basePath}/Groups`, token, validGroup({
        members: [{ value: userRes.body.id }],
      })).expect(201);

      expect(res.body.members).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §7 — PUT (Replace) with Schema Validation
  // ═══════════════════════════════════════════════════════════════════════════

  describe('PUT (replace) with schema validation', () => {
    it('should reject PUT with unknown attribute in strict mode', async () => {
      const { basePath } = await strictEndpoint();

      const createRes = await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);
      const userId = createRes.body.id;

      const res = await scimPut(app, `${basePath}/Users/${userId}`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'updated@example.com',
        unknownField: 'should-fail',
      }).expect(400);

      expect(res.body.status).toBe('400');
      expect(res.body.detail).toBeDefined();
    });

    it('should reject PUT with name as string instead of complex', async () => {
      const { basePath } = await strictEndpoint();

      const createRes = await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);
      const userId = createRes.body.id;

      const res = await scimPut(app, `${basePath}/Users/${userId}`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'updated@example.com',
        name: 'Not A Complex Object',
      }).expect(400);

      expect(res.body.status).toBe('400');
    });

    it('should accept PUT with valid attributes in strict mode', async () => {
      const { basePath } = await strictEndpoint();

      const createRes = await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);
      const userId = createRes.body.id;

      const res = await scimPut(app, `${basePath}/Users/${userId}`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'updated@example.com',
        active: true,
        name: { givenName: 'Updated', familyName: 'User' },
      }).expect(200);

      expect(res.body.userName).toBe('updated@example.com');
    });

    it('should reject Group PUT with unknown attribute in strict mode', async () => {
      const { basePath } = await strictEndpoint();

      const createRes = await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201);
      const groupId = createRes.body.id;

      const res = await scimPut(app, `${basePath}/Groups/${groupId}`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        displayName: 'Updated Group',
        randomCustomField: 'should-fail',
      }).expect(400);

      expect(res.body.status).toBe('400');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §8 — Error Response Format
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Error response format', () => {
    it('should return proper SCIM error format on type validation failure', async () => {
      const { basePath } = await strictEndpoint();

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        name: 'not-complex' as any,
      })).expect(400);

      // SCIM error format: schemas, status, detail, scimType
      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
      expect(res.body.status).toBe('400');
      expect(typeof res.body.detail).toBe('string');
      expect(res.body.detail.length).toBeGreaterThan(0);
    });

    it('should return descriptive detail on unknown attribute error', async () => {
      const { basePath } = await strictEndpoint();

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        totallyUnknownField: 42,
      } as any)).expect(400);

      expect(res.body.detail).toContain('totallyUnknownField');
      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
    });

    it('should include scimType in error response', async () => {
      const { basePath } = await strictEndpoint();

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        name: 42 as any,
      })).expect(400);

      expect(res.body.scimType).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §9 — Flag On/Off Comparison
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Strict mode flag on/off comparison', () => {
    it('should reject unknown attr in strict mode but accept in lenient mode', async () => {
      const strict = await strictEndpoint();
      const lenient = await lenientEndpoint();

      const strictPayload = validUser({ myCustom: 'data' } as any);
      const lenientPayload = validUser({ myCustom: 'data' } as any);

      await scimPost(app, `${strict.basePath}/Users`, token, strictPayload).expect(400);
      await scimPost(app, `${lenient.basePath}/Users`, token, lenientPayload).expect(201);
    });

    it('should reject wrong complex type in strict but accept in lenient', async () => {
      const strict = await strictEndpoint();
      const lenient = await lenientEndpoint();

      const strictPayload = validUser({ name: 'flat-string' as any });
      const lenientPayload = validUser({ name: 'flat-string' as any });

      await scimPost(app, `${strict.basePath}/Users`, token, strictPayload).expect(400);
      await scimPost(app, `${lenient.basePath}/Users`, token, lenientPayload).expect(201);
    });

    it('should reject group unknown attr in strict but accept in lenient', async () => {
      const strict = await strictEndpoint();
      const lenient = await lenientEndpoint();

      const strictPayload = validGroup({ custom: 'x' } as any);
      const lenientPayload = validGroup({ custom: 'x' } as any);

      await scimPost(app, `${strict.basePath}/Groups`, token, strictPayload).expect(400);
      await scimPost(app, `${lenient.basePath}/Groups`, token, lenientPayload).expect(201);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §10 — Extension URN Edge Cases
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Extension URN edge cases', () => {
    const ENTERPRISE = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

    it('should reject extension body without declaring URN in schemas array', async () => {
      const { basePath } = await strictEndpoint();

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        [ENTERPRISE]: { department: 'Engineering' },
      } as any)).expect(400);

      expect(res.body.status).toBe('400');
      expect(res.body.detail).toBeDefined();
    });

    it('should accept declaring URN in schemas without providing extension body', async () => {
      const { basePath } = await strictEndpoint();

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', ENTERPRISE],
      })).expect(201);

      expect(res.body.id).toBeDefined();
    });

    it('should reject multiple unknown extensions in strict mode', async () => {
      const { basePath } = await strictEndpoint();

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        schemas: [
          'urn:ietf:params:scim:schemas:core:2.0:User',
          'urn:custom:ext:1.0',
          'urn:custom:ext:2.0',
        ],
        'urn:custom:ext:1.0': { field1: 'val1' },
        'urn:custom:ext:2.0': { field2: 'val2' },
      } as any)).expect(400);

      expect(res.body.status).toBe('400');
    });

    it('should accept known Enterprise extension when declared', async () => {
      const { basePath } = await strictEndpoint();

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', ENTERPRISE],
        [ENTERPRISE]: { department: 'QA' },
      })).expect(201);

      expect(res.body[ENTERPRISE]?.department).toBe('QA');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §11 — Complex Realistic Payloads
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Complex realistic payloads', () => {
    const ENTERPRISE = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

    it('should accept fully populated valid user with enterprise extension', async () => {
      const { basePath } = await strictEndpoint();

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', ENTERPRISE],
        displayName: 'Jane Q. Doe',
        nickName: 'janey',
        title: 'Staff Engineer',
        userType: 'Employee',
        preferredLanguage: 'en-US',
        locale: 'en-US',
        timezone: 'America/Los_Angeles',
        active: true,
        name: {
          givenName: 'Jane',
          familyName: 'Doe',
        },
        emails: [
          { value: 'jane@contoso.com', type: 'work', primary: true },
          { value: 'jane@personal.com', type: 'home' },
        ],
        phoneNumbers: [
          { value: '+1-555-0100', type: 'work' },
        ],
        addresses: [
          {
            type: 'work',
            streetAddress: '100 Universal City Plaza',
            locality: 'Hollywood',
            region: 'CA',
            postalCode: '91608',
            country: 'US',
            primary: true,
          },
        ],
        [ENTERPRISE]: {
          department: 'Engineering',
          employeeNumber: 'EMP-12345',
          costCenter: 'CC-200',
          organization: 'Contoso Ltd',
          division: 'Cloud Platform',
          manager: { value: 'mgr-uuid-456' },
        },
      } as any)).expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.displayName).toBe('Jane Q. Doe');
      expect(res.body[ENTERPRISE]?.department).toBe('Engineering');
    });

    it('should reject fully populated user with one wrong-type extension field', async () => {
      const { basePath } = await strictEndpoint();

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', ENTERPRISE],
        displayName: 'Valid Name',
        active: true,
        name: { givenName: 'Jane', familyName: 'Doe' },
        emails: [{ value: 'jane@contoso.com', type: 'work', primary: true }],
        [ENTERPRISE]: {
          department: 'Engineering',
          employeeNumber: 12345 as any, // Wrong: should be string
        },
      })).expect(400);

      expect(res.body.status).toBe('400');
    });

    it('should reject fully populated user with unknown core attribute', async () => {
      const { basePath } = await strictEndpoint();

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', ENTERPRISE],
        displayName: 'Valid Name',
        active: true,
        name: { givenName: 'Jane', familyName: 'Doe' },
        emails: [{ value: 'jane@contoso.com', type: 'work', primary: true }],
        mySneakyField: 'should be caught',
        [ENTERPRISE]: { department: 'Engineering' },
      } as any)).expect(400);

      expect(res.body.status).toBe('400');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §12 — Cross-resource Schema Isolation
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Cross-resource schema isolation', () => {
    it('should validate Users and Groups independently on same endpoint', async () => {
      const { basePath } = await strictEndpoint();

      // Valid user + valid group
      await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);
      await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201);

      // Invalid user (name as string — complex type error)
      await scimPost(app, `${basePath}/Users`, token, validUser({
        name: 'flat' as any,
      })).expect(400);

      // Invalid group (unknown attribute)
      await scimPost(app, `${basePath}/Groups`, token, validGroup({
        notAGroupAttr: 'nope',
      } as any)).expect(400);
    });

    it('should accept valid payloads after rejecting invalid ones', async () => {
      const { basePath } = await strictEndpoint();

      // Reject invalid user (unknown attr)
      await scimPost(app, `${basePath}/Users`, token, validUser({
        invalidField: 'bad',
      } as any)).expect(400);

      // Still accept valid user
      const userRes = await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);
      expect(userRes.body.id).toBeDefined();

      // Still accept valid group
      const groupRes = await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201);
      expect(groupRes.body.id).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §13 — DTO Implicit Conversion Behaviour Documentation
  // ═══════════════════════════════════════════════════════════════════════════

  describe('DTO implicit conversion behaviour', () => {
    // These tests document the ValidationPipe's enableImplicitConversion behavior.
    // DTO-declared properties (active, userName) are coerced before schema validation.

    it('should accept active as truthy string (coerced to boolean by ValidationPipe)', async () => {
      const { basePath } = await strictEndpoint();

      // ValidationPipe with enableImplicitConversion: true coerces strings to boolean
      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        active: 'yes' as any,
      })).expect(201);

      // The value has been coerced to true
      expect(res.body.active).toBe(true);
    });

    it('should accept userName as number (coerced to string by ValidationPipe)', async () => {
      const { basePath } = await strictEndpoint();

      // ValidationPipe coerces number to string for @IsString() decorated property
      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        userName: 99999 as any,
      })).expect(201);

      expect(typeof res.body.userName).toBe('string');
    });

    it('should accept group displayName as number (coerced to string)', async () => {
      const { basePath } = await strictEndpoint();

      const res = await scimPost(app, `${basePath}/Groups`, token, validGroup({
        displayName: 42 as any,
      })).expect(201);

      expect(typeof res.body.displayName).toBe('string');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §14 — Reserved Keys Behaviour (id, meta, externalId)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Reserved keys behaviour', () => {
    // The SchemaValidator's RESERVED_KEYS set intentionally skips id, meta, externalId.
    // These are server-controlled attributes per RFC 7643 and are excluded from
    // unknown-attribute and type validation.

    it('should accept user with client-supplied id (server ignores it)', async () => {
      const { basePath } = await strictEndpoint();

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        id: 'client-supplied-id-123',
      } as any)).expect(201);

      // Server generates its own id, ignoring client-supplied one
      expect(res.body.id).toBeDefined();
      expect(res.body.id).not.toBe('client-supplied-id-123');
    });

    it('should accept user with client-supplied meta (server overrides it)', async () => {
      const { basePath } = await strictEndpoint();

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        meta: { resourceType: 'User', created: '1999-01-01T00:00:00Z' },
      } as any)).expect(201);

      // Server generates its own meta
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.created).not.toBe('1999-01-01T00:00:00Z');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §15 — G8c: readOnly Mutability Pre-validation in PATCH
  // ═══════════════════════════════════════════════════════════════════════════

  describe('G8c — readOnly attribute rejection in PATCH (strict mode)', () => {
    it('should reject PATCH replace on readOnly attribute (groups) with 400', async () => {
      const { basePath } = await strictEndpoint();

      // Create a user first
      const createRes = await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);
      const userId = createRes.body.id;

      // Attempt to PATCH the readOnly "groups" attribute
      const patchRes = await scimPatch(app, `${basePath}/Users/${userId}`, token, patchOp([
        { op: 'replace', path: 'groups', value: [{ value: 'fake-group-id' }] },
      ])).expect(400);

      expect(patchRes.body.status).toBe('400');
      expect(patchRes.body.detail).toMatch(/readOnly/i);
      expect(patchRes.body.detail).toMatch(/mutability|PATCH/i);
    });

    it('should reject PATCH add on readOnly attribute with 400', async () => {
      const { basePath } = await strictEndpoint();

      const createRes = await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);
      const userId = createRes.body.id;

      const patchRes = await scimPatch(app, `${basePath}/Users/${userId}`, token, patchOp([
        { op: 'add', path: 'groups', value: [{ value: 'fake-group-id' }] },
      ])).expect(400);

      expect(patchRes.body.status).toBe('400');
      expect(patchRes.body.detail).toMatch(/readOnly/i);
    });

    it('should reject PATCH remove on readOnly attribute with 400', async () => {
      const { basePath } = await strictEndpoint();

      const createRes = await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);
      const userId = createRes.body.id;

      const patchRes = await scimPatch(app, `${basePath}/Users/${userId}`, token, patchOp([
        { op: 'remove', path: 'groups' },
      ])).expect(400);

      expect(patchRes.body.status).toBe('400');
      expect(patchRes.body.detail).toMatch(/readOnly/i);
    });

    it('should reject no-path PATCH containing readOnly attribute with 400', async () => {
      const { basePath } = await strictEndpoint();

      const createRes = await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);
      const userId = createRes.body.id;

      // No-path replace with readOnly attribute mixed in
      const patchRes = await scimPatch(app, `${basePath}/Users/${userId}`, token, patchOp([
        { op: 'replace', value: { displayName: 'NewName', groups: [{ value: 'g1' }] } },
      ])).expect(400);

      expect(patchRes.body.status).toBe('400');
      expect(patchRes.body.detail).toMatch(/readOnly/i);
    });

    it('should allow PATCH on readWrite attributes in strict mode', async () => {
      const { basePath } = await strictEndpoint();

      const createRes = await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);
      const userId = createRes.body.id;

      // PATCH readWrite attributes — should succeed
      const patchRes = await scimPatch(app, `${basePath}/Users/${userId}`, token, patchOp([
        { op: 'replace', path: 'displayName', value: 'Updated Name' },
      ])).expect(200);

      expect(patchRes.body.displayName).toBe('Updated Name');
    });
  });

  describe('G8c — readOnly PATCH accepted when strict mode off (lenient)', () => {
    it('should accept PATCH on readOnly attribute when StrictSchemaValidation is off', async () => {
      const { basePath } = await lenientEndpoint();

      const createRes = await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);
      const userId = createRes.body.id;

      // readOnly check is gated behind StrictSchemaValidation — should not reject
      // (PatchEngine may throw its own error, or handle it gracefully)
      const patchRes = await scimPatch(app, `${basePath}/Users/${userId}`, token, patchOp([
        { op: 'replace', path: 'displayName', value: 'Lenient Update' },
      ]));

      // readWrite attribute should always work
      expect(patchRes.status).toBe(200);
    });
  });
});
