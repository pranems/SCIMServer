import { describe, expect, it } from 'vitest';
import {
  buildCreatePayload,
  buildPatchOperations,
  resolveEffectiveResourceShape,
  type ProfileResourceSchema,
  type ProfileResourceType,
} from './profile-resource-shape';

const USER_URN = 'urn:ietf:params:scim:schemas:core:2.0:User';
const ENTERPRISE_URN = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

const schemas: ProfileResourceSchema[] = [
  {
    id: USER_URN,
    name: 'User',
    attributes: [
      { name: 'id', type: 'string', mutability: 'readOnly', returned: 'always' },
      { name: 'userName', type: 'string', required: true },
      {
        name: 'name',
        type: 'complex',
        subAttributes: [
          { name: 'givenName', type: 'string' },
          { name: 'familyName', type: 'string' },
        ],
      },
      {
        name: 'emails',
        type: 'complex',
        multiValued: true,
        subAttributes: [
          { name: 'value', type: 'string', required: true },
          { name: 'type', type: 'string', canonicalValues: ['work', 'home'] },
          { name: 'primary', type: 'boolean' },
        ],
      },
      { name: 'active', type: 'boolean' },
    ],
  },
  {
    id: ENTERPRISE_URN,
    name: 'EnterpriseUser',
    attributes: [
      { name: 'employeeNumber', type: 'string' },
      { name: 'costCenter', type: 'string' },
    ],
  },
];

const userType: ProfileResourceType = {
  id: 'User',
  name: 'User',
  endpoint: '/Users',
  schema: USER_URN,
  schemaExtensions: [{ schema: ENTERPRISE_URN, required: false }],
};

describe('profile resource shape', () => {
  it('combines core and extension schemas while excluding readOnly attributes', () => {
    const shape = resolveEffectiveResourceShape(userType, schemas);

    expect(shape.fields.map((field) => field.path)).toEqual([
      'userName',
      'name',
      'emails',
      'active',
      `${ENTERPRISE_URN}:employeeNumber`,
      `${ENTERPRISE_URN}:costCenter`,
    ]);
    expect(shape.fields.find((field) => field.path === 'userName')).toMatchObject({
      required: true,
      inputKind: 'text',
      example: 'alex.taylor@example.com',
    });
    expect(shape.fields.find((field) => field.path === 'emails')).toMatchObject({
      inputKind: 'json',
      example: [{ value: 'alex.taylor@example.com', type: 'work', primary: true }],
    });
  });

  it('builds a working create payload with extension data nested under its URN', () => {
    const shape = resolveEffectiveResourceShape(userType, schemas);
    const values = Object.fromEntries(shape.fields.map((field) => [field.id, field.example]));

    expect(buildCreatePayload(shape, values)).toEqual({
      schemas: [USER_URN, ENTERPRISE_URN],
      userName: 'alex.taylor@example.com',
      name: { givenName: 'Alex', familyName: 'Taylor' },
      emails: [{ value: 'alex.taylor@example.com', type: 'work', primary: true }],
      active: true,
      [ENTERPRISE_URN]: {
        employeeNumber: 'employee-number-example',
        costCenter: 'cost-center-example',
      },
    });
  });

  it('builds extension-aware PATCH operations only for changed writable fields', () => {
    const shape = resolveEffectiveResourceShape(userType, schemas);
    const original = {
      schemas: [USER_URN, ENTERPRISE_URN],
      userName: 'before@example.com',
      active: true,
      [ENTERPRISE_URN]: { employeeNumber: '100' },
    };
    const values = {
      [`${USER_URN}|userName`]: 'after@example.com',
      [`${USER_URN}|active`]: true,
      [`${ENTERPRISE_URN}|employeeNumber`]: '200',
    };

    expect(buildPatchOperations(shape, original, values)).toEqual([
      { op: 'replace', path: 'userName', value: 'after@example.com' },
      { op: 'replace', path: `${ENTERPRISE_URN}:employeeNumber`, value: '200' },
    ]);
  });

  it('generates valid fields and examples for a custom resource type', () => {
    const deviceUrn = 'urn:example:schemas:Device';
    const shape = resolveEffectiveResourceShape(
      { id: 'Device', name: 'Device', endpoint: '/Devices', schema: deviceUrn },
      [{
        id: deviceUrn,
        name: 'Device',
        attributes: [
          { name: 'serialNumber', type: 'string', required: true },
          { name: 'compliant', type: 'boolean' },
          { name: 'riskScore', type: 'decimal' },
        ],
      }],
    );

    expect(shape.exampleResource).toEqual({
      schemas: [deviceUrn],
      serialNumber: 'serial-number-example',
      compliant: true,
      riskScore: 1.5,
    });
  });
});