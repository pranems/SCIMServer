import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import {
  scimPost,
  scimGet,
  scimPut,
  scimPatch,
  createEndpointWithConfig,
  scimBasePath,
} from './helpers/request.helper';
import { validUser, validGroup, patchOp, resetFixtureCounter } from './helpers/fixtures';

/**
 * RFC 7643 §2.2 — Immutable attribute enforcement E2E tests.
 *
 * Validates that attributes with `mutability: 'immutable'` can be set on
 * creation but CANNOT be changed on PUT or PATCH operations.
 *
 * Uses a custom schema extension with an immutable attribute to test
 * enforcement across the full CRUD lifecycle.
 */
describe('Immutable Attribute Enforcement (E2E)', () => {
  let app: INestApplication;
  let token: string;

  const EXT_URN = 'urn:ietf:params:scim:schemas:extension:test:2.0:Immutable';

  async function registerImmutableExtension(endpointId: string): Promise<void> {
    const ext = {
      schemaUrn: EXT_URN,
      name: 'Immutable Test Extension',
      description: 'Extension with immutable attribute for testing enforcement',
      resourceTypeId: 'User',
      required: false,
      attributes: [
        {
          name: 'employeeId',
          type: 'string',
          multiValued: false,
          required: false,
          mutability: 'immutable',
          returned: 'default',
          description: 'Employee ID — set once on creation, cannot be changed',
        },
        {
          name: 'department',
          type: 'string',
          multiValued: false,
          required: false,
          mutability: 'readWrite',
          returned: 'default',
          description: 'Department — mutable, can be changed anytime',
        },
      ],
    };

    await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/schemas`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send(ext)
      .expect(201);
  }

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  // ───────────── Custom extension — immutable enforcement ─────────────

  describe('Custom extension immutable attribute', () => {
    let endpointId: string;
    let basePath: string;
    let userId: string;

    beforeAll(async () => {
      resetFixtureCounter();
      endpointId = await createEndpointWithConfig(app, token, {
        StrictSchemaValidation: 'True',
      });
      basePath = scimBasePath(endpointId);
      await registerImmutableExtension(endpointId);
    });

    it('POST should accept immutable attribute on creation', async () => {
      const user = validUser({
        [EXT_URN]: {
          employeeId: 'EMP-001',
          department: 'Engineering',
        },
        schemas: [
          'urn:ietf:params:scim:schemas:core:2.0:User',
          EXT_URN,
        ],
      });

      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(201);
      userId = res.body.id;
      expect(res.body[EXT_URN]?.employeeId).toBe('EMP-001');
      expect(res.body[EXT_URN]?.department).toBe('Engineering');
    });

    it('PUT should reject changing immutable attribute with 400', async () => {
      const user = validUser({
        [EXT_URN]: {
          employeeId: 'EMP-002-CHANGED', // attempting to change immutable attr
          department: 'R&D',
        },
        schemas: [
          'urn:ietf:params:scim:schemas:core:2.0:User',
          EXT_URN,
        ],
      });

      const res = await scimPut(app, `${basePath}/Users/${userId}`, token, user);

      // Server should reject with 400 (mutability violation)
      expect(res.status).toBe(400);
      expect(res.body.detail).toMatch(/immutable/i);
    });

    it('PUT should allow setting same immutable value (no change)', async () => {
      const user = validUser({
        [EXT_URN]: {
          employeeId: 'EMP-001', // same value as creation — allowed
          department: 'Sales',
        },
        schemas: [
          'urn:ietf:params:scim:schemas:core:2.0:User',
          EXT_URN,
        ],
      });

      const res = await scimPut(app, `${basePath}/Users/${userId}`, token, user);

      // Same value → should succeed
      expect(res.status).toBe(200);
      expect(res.body[EXT_URN]?.department).toBe('Sales');
    });

    it('PATCH should reject changing immutable attribute', async () => {
      const patch = patchOp([
        { op: 'replace', path: `${EXT_URN}:employeeId`, value: 'EMP-999' },
      ]);

      const res = await scimPatch(
        app,
        `${basePath}/Users/${userId}`,
        token,
        patch,
      );

      expect(res.status).toBe(400);
      expect(res.body.detail).toMatch(/immutable/i);
    });

    it('PATCH should allow changing mutable attribute alongside immutable check', async () => {
      const patch = patchOp([
        { op: 'replace', path: `${EXT_URN}:department`, value: 'Legal' },
      ]);

      const res = await scimPatch(
        app,
        `${basePath}/Users/${userId}`,
        token,
        patch,
      ).expect(200);

      expect(res.body[EXT_URN]?.department).toBe('Legal');
    });

    it('GET should still return the original immutable value', async () => {
      const res = await scimGet(
        app,
        `${basePath}/Users/${userId}`,
        token,
      ).expect(200);

      expect(res.body[EXT_URN]?.employeeId).toBe('EMP-001');
    });
  });

  // ───────────── Built-in Group $ref immutable ─────────────

  describe('Group members.$ref immutability', () => {
    let endpointId: string;
    let basePath: string;

    beforeAll(async () => {
      resetFixtureCounter();
      endpointId = await createEndpointWithConfig(app, token, {});
      basePath = scimBasePath(endpointId);
    });

    it('Group members.$ref should be in schema as immutable', async () => {
      const res = await scimGet(
        app,
        `${basePath}/Schemas/urn:ietf:params:scim:schemas:core:2.0:Group`,
        token,
      ).expect(200);

      const membersAttr = res.body?.attributes?.find(
        (a: any) => a.name === 'members',
      );
      expect(membersAttr).toBeDefined();
      const refSub = membersAttr?.subAttributes?.find(
        (s: any) => s.name === '$ref',
      );
      if (refSub) {
        expect(refSub.mutability).toBe('immutable');
      }
    });
  });

  // ───────────── Custom resource type immutable ─────────────

  describe('Custom resource type with immutable attribute', () => {
    const DEVICE_SCHEMA_URN = 'urn:ietf:params:scim:schemas:core:2.0:TestDevice';
    let endpointId: string;
    let basePath: string;
    let deviceId: string;

    async function registerDeviceRT(epId: string): Promise<void> {
      // Register custom resource type
      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${epId}/resource-types`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({
          name: 'TestDevice',
          description: 'Device with immutable serial number',
          schemaUri: DEVICE_SCHEMA_URN,
          endpoint: '/TestDevices',
          schemaExtensions: [],
        })
        .expect(201);

      // Register schema with immutable attribute
      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${epId}/schemas`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({
          schemaUrn: DEVICE_SCHEMA_URN,
          name: 'TestDevice Schema',
          description: 'Device with immutable serialNumber',
          resourceTypeId: 'TestDevice',
          required: false,
          attributes: [
            {
              name: 'displayName',
              type: 'string',
              multiValued: false,
              required: false,
              mutability: 'readWrite',
              returned: 'default',
              description: 'Display name of the device',
            },
            {
              name: 'serialNumber',
              type: 'string',
              multiValued: false,
              required: true,
              mutability: 'immutable',
              returned: 'default',
              description: 'Serial number — cannot be changed after creation',
            },
            {
              name: 'location',
              type: 'string',
              multiValued: false,
              required: false,
              mutability: 'readWrite',
              returned: 'default',
              description: 'Physical location',
            },
          ],
        })
        .expect(201);
    }

    beforeAll(async () => {
      resetFixtureCounter();
      endpointId = await createEndpointWithConfig(app, token, {
        CustomResourceTypesEnabled: 'True',
        StrictSchemaValidation: 'True',
      });
      basePath = scimBasePath(endpointId);
      await registerDeviceRT(endpointId);
    });

    it('POST should create device with immutable serialNumber', async () => {
      const res = await scimPost(app, `${basePath}/TestDevices`, token, {
        schemas: [DEVICE_SCHEMA_URN],
        displayName: 'Sensor A',
        serialNumber: 'SN-12345',
        location: 'Building A',
      }).expect(201);

      deviceId = res.body.id;
      expect(res.body.serialNumber).toBe('SN-12345');
    });

    it('PUT should reject changing immutable serialNumber', async () => {
      const res = await scimPut(app, `${basePath}/TestDevices/${deviceId}`, token, {
        schemas: [DEVICE_SCHEMA_URN],
        displayName: 'Sensor A',
        serialNumber: 'SN-99999', // changed
        location: 'Building B',
      });

      expect(res.status).toBe(400);
      expect(res.body.detail).toMatch(/immutable/i);
    });

    it('PUT should allow keeping same immutable value', async () => {
      const res = await scimPut(app, `${basePath}/TestDevices/${deviceId}`, token, {
        schemas: [DEVICE_SCHEMA_URN],
        displayName: 'Sensor A Updated',
        serialNumber: 'SN-12345', // same value
        location: 'Building C',
      });

      expect(res.status).toBe(200);
      expect(res.body.location).toBe('Building C');
    });
  });
});
