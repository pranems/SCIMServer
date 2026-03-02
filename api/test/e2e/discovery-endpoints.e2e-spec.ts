import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import {
  scimGet,
  createEndpoint,
  createEndpointWithConfig,
  scimBasePath,
} from './helpers/request.helper';
import { resetFixtureCounter } from './helpers/fixtures';

describe('Discovery Endpoints (E2E)', () => {
  let app: INestApplication;
  let token: string;
  let endpointId: string;
  let basePath: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    resetFixtureCounter();
    endpointId = await createEndpoint(app, token);
    basePath = scimBasePath(endpointId);
  });

  // ───────────── ServiceProviderConfig ─────────────

  describe('GET /ServiceProviderConfig', () => {
    it('should return a valid ServiceProviderConfig', async () => {
      const res = await scimGet(app, `${basePath}/ServiceProviderConfig`, token).expect(200);

      expect(res.body.schemas).toContain(
        'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig',
      );
      expect(res.body.patch).toBeDefined();
      expect(res.body.patch.supported).toBe(true);
      expect(res.body.filter).toBeDefined();
      expect(res.body.bulk).toBeDefined();
    });

    it('should include all required capability fields', async () => {
      const res = await scimGet(app, `${basePath}/ServiceProviderConfig`, token).expect(200);

      expect(res.body.patch).toBeDefined();
      expect(res.body.patch.supported).toBe(true);
      expect(res.body.filter).toBeDefined();
      expect(res.body.filter.supported).toBe(true);
      expect(res.body.bulk).toBeDefined();
      expect(res.body.changePassword).toBeDefined();
      expect(res.body.sort).toBeDefined();
      expect(res.body.etag).toBeDefined();
      expect(res.body.etag.supported).toBe(true);
    });

    it('should include meta with resourceType (RFC 7644 §4)', async () => {
      const res = await scimGet(app, `${basePath}/ServiceProviderConfig`, token).expect(200);
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.resourceType).toBe('ServiceProviderConfig');
    });
  });

  // ───────────── Schemas ─────────────

  describe('GET /Schemas', () => {
    it('should return SCIM schema definitions', async () => {
      const res = await scimGet(app, `${basePath}/Schemas`, token).expect(200);

      // The response should contain User, EnterpriseUser, and Group schemas
      const body = res.body;
      // Could be a ListResponse or direct array — handle both
      const schemas = body.Resources ?? body;
      const ids = Array.isArray(schemas) ? schemas.map((s: { id: string }) => s.id) : [];

      expect(ids).toContain('urn:ietf:params:scim:schemas:core:2.0:User');
      expect(ids).toContain(
        'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
      );
      expect(ids).toContain('urn:ietf:params:scim:schemas:core:2.0:Group');
    });

    it('should return totalResults including core and extension schemas', async () => {
      const res = await scimGet(app, `${basePath}/Schemas`, token).expect(200);
      // Core: User, Group  +  Extensions: Enterprise, 4 msfttest = 7 total
      expect(res.body.totalResults).toBeGreaterThanOrEqual(3);
      expect(res.body.Resources.length).toBeGreaterThanOrEqual(3);
    });

    // ─── P1: Schema attribute characteristics compliance ─────────────

    it('should include caseExact:false on all User name sub-attributes (R-SUB-1)', async () => {
      const res = await scimGet(app, `${basePath}/Schemas/urn:ietf:params:scim:schemas:core:2.0:User`, token).expect(200);
      const nameAttr = res.body.attributes.find((a: any) => a.name === 'name');
      expect(nameAttr).toBeDefined();
      const expectedSubs = ['formatted', 'familyName', 'givenName', 'middleName', 'honorificPrefix', 'honorificSuffix'];
      for (const subName of expectedSubs) {
        const sub = nameAttr.subAttributes.find((s: any) => s.name === subName);
        expect(sub).toBeDefined();
        expect(sub.caseExact).toBe(false);
      }
    });

    it('should include caseExact:false on all User addresses sub-attributes (R-SUB-3)', async () => {
      const res = await scimGet(app, `${basePath}/Schemas/urn:ietf:params:scim:schemas:core:2.0:User`, token).expect(200);
      const addrAttr = res.body.attributes.find((a: any) => a.name === 'addresses');
      expect(addrAttr).toBeDefined();
      const expectedSubs = ['formatted', 'streetAddress', 'locality', 'region', 'postalCode', 'country'];
      for (const subName of expectedSubs) {
        const sub = addrAttr.subAttributes.find((s: any) => s.name === subName);
        expect(sub).toBeDefined();
        expect(sub.caseExact).toBe(false);
      }
    });

    it('should include uniqueness:none on User externalId (R-UNIQ-1)', async () => {
      const res = await scimGet(app, `${basePath}/Schemas/urn:ietf:params:scim:schemas:core:2.0:User`, token).expect(200);
      const extId = res.body.attributes.find((a: any) => a.name === 'externalId');
      expect(extId).toBeDefined();
      expect(extId.uniqueness).toBe('none');
    });

    it('should include $ref sub-attribute on Group members with referenceTypes (R-REF-1)', async () => {
      const res = await scimGet(app, `${basePath}/Schemas/urn:ietf:params:scim:schemas:core:2.0:Group`, token).expect(200);
      const membersAttr = res.body.attributes.find((a: any) => a.name === 'members');
      expect(membersAttr).toBeDefined();
      const refSub = membersAttr.subAttributes.find((s: any) => s.name === '$ref');
      expect(refSub).toBeDefined();
      expect(refSub.type).toBe('reference');
      expect(refSub.mutability).toBe('immutable');
      expect(refSub.referenceTypes).toEqual(['User', 'Group']);
    });

    it('should include uniqueness:server on Group displayName (R-UNIQ-1)', async () => {
      const res = await scimGet(app, `${basePath}/Schemas/urn:ietf:params:scim:schemas:core:2.0:Group`, token).expect(200);
      const displayName = res.body.attributes.find((a: any) => a.name === 'displayName');
      expect(displayName).toBeDefined();
      expect(displayName.uniqueness).toBe('server');
    });

    it('should include uniqueness:none on Group externalId (R-UNIQ-1)', async () => {
      const res = await scimGet(app, `${basePath}/Schemas/urn:ietf:params:scim:schemas:core:2.0:Group`, token).expect(200);
      const extId = res.body.attributes.find((a: any) => a.name === 'externalId');
      expect(extId).toBeDefined();
      expect(extId.uniqueness).toBe('none');
    });
  });

  // ───────────── ResourceTypes ─────────────

  describe('GET /ResourceTypes', () => {
    it('should return User and Group resource types', async () => {
      const res = await scimGet(app, `${basePath}/ResourceTypes`, token).expect(200);

      const body = res.body;
      const types = body.Resources ?? body;
      const names = Array.isArray(types) ? types.map((t: { name: string }) => t.name) : [];

      expect(names).toContain('User');
      expect(names).toContain('Group');
    });

    it('should include endpoint and schema in each resource type', async () => {
      const res = await scimGet(app, `${basePath}/ResourceTypes`, token).expect(200);

      const types = res.body.Resources ?? res.body;
      const userType = (types as Array<{ name: string; endpoint: string; schema: string; schemaExtensions?: any[] }>)
        .find((t) => t.name === 'User');

      expect(userType).toBeDefined();
      expect(userType!.endpoint).toBe('/Users');
      expect(userType!.schema).toBe('urn:ietf:params:scim:schemas:core:2.0:User');
    });

    it('should include Enterprise User extension on User resource type', async () => {
      const res = await scimGet(app, `${basePath}/ResourceTypes`, token).expect(200);

      const types = res.body.Resources ?? res.body;
      const userType = (types as Array<{ name: string; schemaExtensions?: any[] }>)
        .find((t) => t.name === 'User');

      expect(userType!.schemaExtensions!.length).toBeGreaterThanOrEqual(1);
      const enterpriseExt = userType!.schemaExtensions!.find(
        (e: any) => e.schema === 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
      );
      expect(enterpriseExt).toBeDefined();
      expect(enterpriseExt!.required).toBe(false);
    });
  });

  // ───────────── D1: Unauthenticated Discovery Access ─────────────

  describe('Unauthenticated Discovery Access (D1)', () => {
    it('should allow GET /ServiceProviderConfig without authentication', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/ServiceProviderConfig')
        .expect(200);

      expect(res.body.schemas).toContain(
        'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig',
      );
    });

    it('should allow GET /Schemas without authentication', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/Schemas')
        .expect(200);

      expect(res.body.totalResults).toBeGreaterThanOrEqual(3);
    });

    it('should allow GET /ResourceTypes without authentication', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/ResourceTypes')
        .expect(200);

      expect(res.body.totalResults).toBe(2);
    });

    it('should allow GET /endpoints/:id/Schemas without authentication', async () => {
      const res = await request(app.getHttpServer())
        .get(`${basePath}/Schemas`)
        .expect(200);

      expect(res.body.totalResults).toBeGreaterThanOrEqual(3);
    });

    it('should allow GET /endpoints/:id/ResourceTypes without authentication', async () => {
      const res = await request(app.getHttpServer())
        .get(`${basePath}/ResourceTypes`)
        .expect(200);

      expect(res.body.totalResults).toBe(2);
    });

    it('should allow GET /endpoints/:id/ServiceProviderConfig without authentication', async () => {
      const res = await request(app.getHttpServer())
        .get(`${basePath}/ServiceProviderConfig`)
        .expect(200);

      expect(res.body.schemas).toContain(
        'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig',
      );
    });
  });

  // ───────────── D2: Individual Schema Lookup ─────────────

  describe('GET /Schemas/:uri (D2)', () => {
    it('should return User schema by URN (root-level)', async () => {
      const res = await scimGet(
        app,
        '/scim/Schemas/urn:ietf:params:scim:schemas:core:2.0:User',
        token,
      ).expect(200);

      expect(res.body.id).toBe('urn:ietf:params:scim:schemas:core:2.0:User');
      expect(res.body.name).toBe('User');
    });

    it('should return 404 for unknown schema URN (root-level)', async () => {
      const res = await scimGet(
        app,
        '/scim/Schemas/urn:unknown:schema',
        token,
      ).expect(404);

      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
      expect(res.body.status).toBe('404');
    });

    it('should return User schema by URN (endpoint-scoped)', async () => {
      const res = await scimGet(
        app,
        `${basePath}/Schemas/urn:ietf:params:scim:schemas:core:2.0:User`,
        token,
      ).expect(200);

      expect(res.body.id).toBe('urn:ietf:params:scim:schemas:core:2.0:User');
      expect(res.body.name).toBe('User');
    });

    it('should return 404 for unknown schema URN (endpoint-scoped)', async () => {
      const res = await scimGet(
        app,
        `${basePath}/Schemas/urn:unknown:schema`,
        token,
      ).expect(404);

      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
    });
  });

  // ───────────── D3: Individual ResourceType Lookup ─────────────

  describe('GET /ResourceTypes/:id (D3)', () => {
    it('should return User resource type by id (root-level)', async () => {
      const res = await scimGet(
        app,
        '/scim/ResourceTypes/User',
        token,
      ).expect(200);

      expect(res.body.id).toBe('User');
      expect(res.body.name).toBe('User');
      expect(res.body.endpoint).toBe('/Users');
    });

    it('should return Group resource type by id (root-level)', async () => {
      const res = await scimGet(
        app,
        '/scim/ResourceTypes/Group',
        token,
      ).expect(200);

      expect(res.body.id).toBe('Group');
      expect(res.body.name).toBe('Group');
    });

    it('should return 404 for unknown resource type id (root-level)', async () => {
      const res = await scimGet(
        app,
        '/scim/ResourceTypes/Unknown',
        token,
      ).expect(404);

      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
      expect(res.body.status).toBe('404');
    });

    it('should return User resource type by id (endpoint-scoped)', async () => {
      const res = await scimGet(
        app,
        `${basePath}/ResourceTypes/User`,
        token,
      ).expect(200);

      expect(res.body.id).toBe('User');
    });

    it('should return 404 for unknown resource type id (endpoint-scoped)', async () => {
      const res = await scimGet(
        app,
        `${basePath}/ResourceTypes/Unknown`,
        token,
      ).expect(404);

      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
    });
  });

  // ───────────── D4+D5: schemas[] arrays on resources ─────────────

  describe('schemas[] on discovery resources (D4+D5)', () => {
    it('should include schemas[] on each Schema definition (D4)', async () => {
      const res = await scimGet(app, `${basePath}/Schemas`, token).expect(200);

      for (const schema of res.body.Resources) {
        expect(schema.schemas).toEqual([
          'urn:ietf:params:scim:schemas:core:2.0:Schema',
        ]);
      }
    });

    it('should include schemas[] on each ResourceType definition (D5)', async () => {
      const res = await scimGet(app, `${basePath}/ResourceTypes`, token).expect(200);

      for (const rt of res.body.Resources) {
        expect(rt.schemas).toEqual([
          'urn:ietf:params:scim:schemas:core:2.0:ResourceType',
        ]);
      }
    });
  });

  // ───────────── D6: primary:true on auth scheme ─────────────

  describe('primary flag on authenticationSchemes (D6)', () => {
    it('should include primary:true on auth scheme in SPC', async () => {
      const res = await scimGet(app, `${basePath}/ServiceProviderConfig`, token).expect(200);

      expect(res.body.authenticationSchemes).toHaveLength(1);
      expect(res.body.authenticationSchemes[0].primary).toBe(true);
    });
  });

  // ───────────── Multi-Tenant / Endpoint-Specific Discovery ─────────────

  describe('Endpoint-Specific Discovery (Multi-Tenant)', () => {
    describe('ServiceProviderConfig reflects per-endpoint config', () => {
      it('should return bulk.supported=false when BulkOperationsEnabled=false', async () => {
        const epId = await createEndpointWithConfig(app, token, {
          BulkOperationsEnabled: 'False',
        });
        const epPath = scimBasePath(epId);

        const res = await scimGet(app, `${epPath}/ServiceProviderConfig`, token).expect(200);
        expect(res.body.bulk.supported).toBe(false);
      });

      it('should return bulk.supported=true when BulkOperationsEnabled=true', async () => {
        const epId = await createEndpointWithConfig(app, token, {
          BulkOperationsEnabled: 'True',
        });
        const epPath = scimBasePath(epId);

        const res = await scimGet(app, `${epPath}/ServiceProviderConfig`, token).expect(200);
        expect(res.body.bulk.supported).toBe(true);
      });

      it('root-level SPC always returns bulk.supported=true (global default)', async () => {
        // Even with endpoints that disable bulk, root-level returns global defaults
        await createEndpointWithConfig(app, token, {
          BulkOperationsEnabled: 'False',
        });

        const rootRes = await scimGet(app, '/scim/ServiceProviderConfig', token).expect(200);
        expect(rootRes.body.bulk.supported).toBe(true);
      });

      it('two endpoints with different configs return different SPC', async () => {
        const epBulkOff = await createEndpointWithConfig(app, token, {
          BulkOperationsEnabled: 'False',
        });
        const epBulkOn = await createEndpointWithConfig(app, token, {
          BulkOperationsEnabled: 'True',
        });

        const resOff = await scimGet(
          app,
          `${scimBasePath(epBulkOff)}/ServiceProviderConfig`,
          token,
        ).expect(200);
        const resOn = await scimGet(
          app,
          `${scimBasePath(epBulkOn)}/ServiceProviderConfig`,
          token,
        ).expect(200);

        expect(resOff.body.bulk.supported).toBe(false);
        expect(resOn.body.bulk.supported).toBe(true);
      });
    });

    describe('Schemas and ResourceTypes are endpoint-scoped', () => {
      it('endpoint-scoped Schemas includes core schemas', async () => {
        const res = await scimGet(app, `${basePath}/Schemas`, token).expect(200);
        const ids = res.body.Resources.map((s: any) => s.id);

        expect(ids).toContain('urn:ietf:params:scim:schemas:core:2.0:User');
        expect(ids).toContain('urn:ietf:params:scim:schemas:core:2.0:Group');
        expect(ids).toContain(
          'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
        );
      });

      it('endpoint-scoped ResourceTypes includes User and Group with extensions', async () => {
        const res = await scimGet(app, `${basePath}/ResourceTypes`, token).expect(200);
        const types = res.body.Resources;
        const userType = types.find((t: any) => t.name === 'User');
        const groupType = types.find((t: any) => t.name === 'Group');

        expect(userType).toBeDefined();
        expect(groupType).toBeDefined();
        expect(userType.schemaExtensions.length).toBeGreaterThanOrEqual(1);
        expect(
          userType.schemaExtensions.some(
            (e: any) =>
              e.schema ===
              'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
          ),
        ).toBe(true);
      });

      it('endpoint-scoped individual schema lookup works', async () => {
        const res = await scimGet(
          app,
          `${basePath}/Schemas/urn:ietf:params:scim:schemas:core:2.0:User`,
          token,
        ).expect(200);

        expect(res.body.id).toBe('urn:ietf:params:scim:schemas:core:2.0:User');
        expect(res.body.schemas).toEqual([
          'urn:ietf:params:scim:schemas:core:2.0:Schema',
        ]);
      });

      it('endpoint-scoped individual resource type lookup works', async () => {
        const res = await scimGet(
          app,
          `${basePath}/ResourceTypes/User`,
          token,
        ).expect(200);

        expect(res.body.id).toBe('User');
        expect(res.body.schemas).toEqual([
          'urn:ietf:params:scim:schemas:core:2.0:ResourceType',
        ]);
        expect(res.body.schemaExtensions.length).toBeGreaterThanOrEqual(1);
      });
    });

    describe('Unauthenticated endpoint-scoped discovery', () => {
      it('all endpoint-scoped discovery routes work without auth', async () => {
        const server = app.getHttpServer();

        // SPC
        const spc = await request(server)
          .get(`${basePath}/ServiceProviderConfig`)
          .expect(200);
        expect(spc.body.schemas).toContain(
          'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig',
        );

        // Schemas list
        const schemas = await request(server)
          .get(`${basePath}/Schemas`)
          .expect(200);
        expect(schemas.body.totalResults).toBeGreaterThanOrEqual(3);

        // ResourceTypes list
        const rts = await request(server)
          .get(`${basePath}/ResourceTypes`)
          .expect(200);
        expect(rts.body.totalResults).toBeGreaterThanOrEqual(2);

        // Individual schema
        const schema = await request(server)
          .get(
            `${basePath}/Schemas/urn:ietf:params:scim:schemas:core:2.0:User`,
          )
          .expect(200);
        expect(schema.body.id).toBe(
          'urn:ietf:params:scim:schemas:core:2.0:User',
        );

        // Individual resource type
        const rt = await request(server)
          .get(`${basePath}/ResourceTypes/User`)
          .expect(200);
        expect(rt.body.id).toBe('User');
      });
    });
  });
});
