/**
 * CreateEndpointSchemaDto — DTO validation tests.
 *
 * Verifies class-validator decorators on the DTO used for
 * POST /admin/endpoints/:endpointId/schemas.
 */
import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateEndpointSchemaDto, SchemaAttributeDto } from './create-endpoint-schema.dto';

function toDto(plain: Record<string, unknown>): CreateEndpointSchemaDto {
  return plainToInstance(CreateEndpointSchemaDto, plain);
}

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaUrn: 'urn:ietf:params:scim:schemas:extension:custom:2.0:User',
    name: 'Custom Extension',
    description: 'A test extension',
    resourceTypeId: 'User',
    required: false,
    attributes: [
      {
        name: 'badgeNumber',
        type: 'string',
        multiValued: false,
        required: false,
        description: 'Employee badge number',
      },
    ],
    ...overrides,
  };
}

describe('CreateEndpointSchemaDto', () => {
  // ─── Valid payloads ─────────────────────────────────────────────────

  it('should pass validation with a complete valid payload', async () => {
    const dto = toDto(validPayload());
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should pass with only required fields (schemaUrn, name, attributes)', async () => {
    const dto = toDto({
      schemaUrn: 'urn:test:minimal',
      name: 'Minimal',
      attributes: [
        { name: 'field', type: 'string', multiValued: false, required: false },
      ],
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should pass with empty attributes array', async () => {
    const dto = toDto({
      schemaUrn: 'urn:test:empty',
      name: 'EmptyAttrs',
      attributes: [],
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  // ─── schemaUrn validation ──────────────────────────────────────────

  describe('schemaUrn', () => {
    it('should fail when schemaUrn is missing', async () => {
      const dto = toDto(validPayload({ schemaUrn: undefined }));
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'schemaUrn')).toBe(true);
    });

    it('should fail when schemaUrn is empty string', async () => {
      const dto = toDto(validPayload({ schemaUrn: '' }));
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'schemaUrn')).toBe(true);
    });

    it('should fail when schemaUrn exceeds 512 chars', async () => {
      const dto = toDto(validPayload({ schemaUrn: 'urn:' + 'x'.repeat(512) }));
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'schemaUrn')).toBe(true);
    });

    it('should fail when schemaUrn is not a string', async () => {
      const dto = toDto(validPayload({ schemaUrn: 12345 }));
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'schemaUrn')).toBe(true);
    });
  });

  // ─── name validation ──────────────────────────────────────────────

  describe('name', () => {
    it('should fail when name is missing', async () => {
      const dto = toDto(validPayload({ name: undefined }));
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'name')).toBe(true);
    });

    it('should fail when name is empty string', async () => {
      const dto = toDto(validPayload({ name: '' }));
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'name')).toBe(true);
    });

    it('should fail when name exceeds 255 chars', async () => {
      const dto = toDto(validPayload({ name: 'x'.repeat(256) }));
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'name')).toBe(true);
    });
  });

  // ─── description validation ────────────────────────────────────────

  describe('description', () => {
    it('should pass when description is omitted', async () => {
      const { description, ...rest } = validPayload();
      const dto = toDto(rest);
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should fail when description is not a string', async () => {
      const dto = toDto(validPayload({ description: 123 }));
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'description')).toBe(true);
    });
  });

  // ─── resourceTypeId validation ────────────────────────────────────

  describe('resourceTypeId', () => {
    it('should pass when resourceTypeId is omitted', async () => {
      const { resourceTypeId, ...rest } = validPayload();
      const dto = toDto(rest);
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should fail when resourceTypeId exceeds 50 chars', async () => {
      const dto = toDto(validPayload({ resourceTypeId: 'x'.repeat(51) }));
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'resourceTypeId')).toBe(true);
    });
  });

  // ─── required validation ──────────────────────────────────────────

  describe('required', () => {
    it('should pass when required is omitted (defaults to false in usage)', async () => {
      const { required, ...rest } = validPayload();
      const dto = toDto(rest);
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should pass with required=true', async () => {
      const dto = toDto(validPayload({ required: true }));
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should fail when required is not a boolean', async () => {
      const dto = toDto(validPayload({ required: 'yes' }));
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'required')).toBe(true);
    });
  });

  // ─── attributes validation ────────────────────────────────────────

  describe('attributes', () => {
    it('should fail when attributes is missing', async () => {
      const dto = toDto(validPayload({ attributes: undefined }));
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'attributes')).toBe(true);
    });

    it('should fail when attributes is not an array', async () => {
      const dto = toDto(validPayload({ attributes: 'not-an-array' }));
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'attributes')).toBe(true);
    });
  });
});

// ─── SchemaAttributeDto ─────────────────────────────────────────────────

describe('SchemaAttributeDto', () => {
  function toAttrDto(plain: Record<string, unknown>): SchemaAttributeDto {
    return plainToInstance(SchemaAttributeDto, plain);
  }

  function validAttr(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      name: 'field',
      type: 'string',
      multiValued: false,
      required: false,
      ...overrides,
    };
  }

  it('should pass with valid required fields', async () => {
    const dto = toAttrDto(validAttr());
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should pass with all optional fields', async () => {
    const dto = toAttrDto(
      validAttr({
        description: 'A field',
        mutability: 'readWrite',
        returned: 'default',
        caseExact: false,
        uniqueness: 'none',
        referenceTypes: ['User'],
      }),
    );
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should fail when name is missing', async () => {
    const dto = toAttrDto(validAttr({ name: undefined }));
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('should fail when type is missing', async () => {
    const dto = toAttrDto(validAttr({ type: undefined }));
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'type')).toBe(true);
  });

  it('should fail when multiValued is not a boolean', async () => {
    const dto = toAttrDto(validAttr({ multiValued: 'yes' }));
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'multiValued')).toBe(true);
  });

  it('should fail when required is not a boolean', async () => {
    const dto = toAttrDto(validAttr({ required: 'yes' }));
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'required')).toBe(true);
  });

  it('should accept nested subAttributes', async () => {
    const dto = toAttrDto(
      validAttr({
        subAttributes: [
          { name: 'sub1', type: 'string', multiValued: false, required: false },
        ],
      }),
    );
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
