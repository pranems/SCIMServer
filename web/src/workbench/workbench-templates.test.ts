import { describe, expect, it } from 'vitest';
import {
  buildEndpointWorkbenchTemplates,
  buildResourceWorkbenchTemplates,
  getStaticWorkbenchTemplates,
} from './workbench-templates';
import type {
  ProfileResourceSchema,
  ProfileResourceType,
} from '../resources/profile-resource-shape';

describe('Workbench request templates', () => {
  it('provides ready-to-run static server and admin examples', () => {
    const templates = getStaticWorkbenchTemplates('run-42');

    expect(templates.find((template) => template.id === 'server-health')).toMatchObject({
      category: 'Server',
      method: 'GET',
      path: '/scim/health',
    });
    expect(templates.find((template) => template.id === 'admin-create-endpoint')).toMatchObject({
      category: 'Admin',
      method: 'POST',
      path: '/scim/admin/endpoints',
      body: {
        name: 'workbench-endpoint-run-42',
        displayName: 'Workbench Endpoint Example',
        profilePreset: 'rfc-standard',
      },
      headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
    });
  });

  it('uses the selected endpoint id in endpoint admin examples', () => {
    const templates = buildEndpointWorkbenchTemplates('ep-1');

    expect(templates.find((template) => template.id === 'endpoint-update-settings')).toMatchObject({
      category: 'Endpoint',
      method: 'PATCH',
      path: '/scim/admin/endpoints/ep-1',
      body: {
        profile: {
          settings: {
            StrictSchemaValidation: true,
          },
        },
      },
      headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
    });
  });

  it('builds profile-aware create and existing-resource PATCH examples', () => {
    const deviceUrn = 'urn:example:schemas:Device';
    const resourceType: ProfileResourceType = {
      id: 'Device',
      name: 'Device',
      endpoint: '/Devices',
      schema: deviceUrn,
    };
    const schemas: ProfileResourceSchema[] = [{
      id: deviceUrn,
      attributes: [
        { name: 'id', type: 'string', mutability: 'readOnly' },
        { name: 'serialNumber', type: 'string', required: true, uniqueness: 'server' },
        { name: 'compliant', type: 'boolean' },
      ],
    }];
    const templates = buildResourceWorkbenchTemplates({
      endpointId: 'ep-1',
      resourceType,
      schemas,
      existingResource: {
        id: 'device-1',
        schemas: [deviceUrn],
        serialNumber: 'SN-100',
        compliant: true,
        meta: { version: 'W/"v2"' },
      },
      exampleSuffix: 'run-42',
    });

    expect(templates.find((template) => template.id === 'resource-Device-create')).toMatchObject({
      category: 'SCIM resource',
      method: 'POST',
      path: '/scim/endpoints/ep-1/Devices',
      body: {
        schemas: [deviceUrn],
        serialNumber: 'serial-number-run-42',
        compliant: true,
      },
    });
    expect(templates.find((template) => template.id === 'resource-Device-patch')).toMatchObject({
      method: 'PATCH',
      path: '/scim/endpoints/ep-1/Devices/device-1',
      headers: [{ key: 'If-Match', value: 'W/"v2"', enabled: true }],
      body: {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          { op: 'replace', path: 'serialNumber', value: 'SN-100-updated' },
        ],
      },
    });
  });

  it('omits the PATCH example when no existing resource is available', () => {
    const schema = 'urn:example:schemas:Device';
    const templates = buildResourceWorkbenchTemplates({
      endpointId: 'ep-1',
      resourceType: { id: 'Device', name: 'Device', endpoint: '/Devices', schema },
      schemas: [{ id: schema, attributes: [{ name: 'serialNumber', type: 'string' }] }],
    });

    expect(templates.map((template) => template.id)).toEqual(['resource-Device-create']);
  });

  it('cycles canonical values instead of inventing an invalid string', () => {
    const schema = 'urn:example:schemas:Device';
    const templates = buildResourceWorkbenchTemplates({
      endpointId: 'ep-1',
      resourceType: { id: 'Device', name: 'Device', endpoint: '/Devices', schema },
      schemas: [{
        id: schema,
        attributes: [{ name: 'platform', type: 'string', canonicalValues: ['Windows', 'Linux'] }],
      }],
      existingResource: { id: 'device-1', platform: 'Windows' },
    });

    expect(templates[1].body).toMatchObject({
      Operations: [{ op: 'replace', path: 'platform', value: 'Linux' }],
    });
  });

  it('keeps dateTime PATCH values in RFC 3339 form', () => {
    const schema = 'urn:example:schemas:Device';
    const templates = buildResourceWorkbenchTemplates({
      endpointId: 'ep-1',
      resourceType: { id: 'Device', name: 'Device', endpoint: '/Devices', schema },
      schemas: [{ id: schema, attributes: [{ name: 'lastCheckIn', type: 'dateTime' }] }],
      existingResource: { id: 'device-1', lastCheckIn: '2026-01-15T12:00:00.000Z' },
    });

    expect(templates[1].body).toMatchObject({
      Operations: [{
        op: 'replace',
        path: 'lastCheckIn',
        value: '2026-01-15T12:01:00.000Z',
      }],
    });
  });

  it('omits PATCH when the only writable field is multi-valued canonical', () => {
    const schema = 'urn:example:schemas:Device';
    const templates = buildResourceWorkbenchTemplates({
      endpointId: 'ep-1',
      resourceType: { id: 'Device', name: 'Device', endpoint: '/Devices', schema },
      schemas: [{
        id: schema,
        attributes: [{
          name: 'platforms',
          type: 'string',
          multiValued: true,
          canonicalValues: ['Windows', 'Linux'],
        }],
      }],
      existingResource: { id: 'device-1', platforms: ['Windows'] },
    });

    expect(templates.map((template) => template.id)).toEqual(['resource-Device-create']);
  });
});