import { SchemaValidator } from './schema-validator';
import type { SchemaDefinition } from './validation-types';
import { minimalGroupMembersProfile, minimalGroupUrn } from '../../../test/helpers/minimal-group-members.fixture';

const schemas: SchemaDefinition[] = minimalGroupMembersProfile().schemas.filter(schema => schema.id === minimalGroupUrn);

describe('Absent optional complex values under minimal imported schemas', () => {
  for (const mode of ['create', 'replace', 'patch'] as const) {
    it(`ignores internally materialized undefined member keys in ${mode}`, () => {
      const result = SchemaValidator.validate({
        schemas: [minimalGroupUrn], displayName: 'minimal',
        members: [{ value: 'member-1', display: undefined, type: undefined }],
      }, schemas, { strictMode: true, mode });
      expect(result).toMatchObject({ valid: true, errors: [] });
    });
  }

  for (const value of ['supplied', '', null, false, 0]) {
    it(`still rejects undeclared member keys supplied as ${JSON.stringify(value)}`, () => {
      const result = SchemaValidator.validate({
        schemas: [minimalGroupUrn], displayName: 'minimal',
        members: [{ value: 'member-1', display: value }],
      }, schemas, { strictMode: true, mode: 'create' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.objectContaining({
        path: 'members[0].display', scimType: 'invalidSyntax',
      }));
    });
  }
});
