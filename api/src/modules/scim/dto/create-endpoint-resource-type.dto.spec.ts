/**
 * CreateEndpointResourceTypeDto — DTO validation tests.
 *
 * Verifies class-validator decorators on the DTO used for
 * POST /admin/endpoints/:endpointId/resource-types.
 */
import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateEndpointResourceTypeDto } from './create-endpoint-resource-type.dto';

function toDto(plain: Record<string, unknown>): CreateEndpointResourceTypeDto {
  return plainToInstance(CreateEndpointResourceTypeDto, plain);
}

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Device',
    description: 'IoT devices',
    schemaUri: 'urn:ietf:params:scim:schemas:core:2.0:Device',
    endpoint: '/Devices',
    schemaExtensions: [
      { schema: 'urn:example:ext:device:2.0', required: false },
    ],
    ...overrides,
  };
}

describe('CreateEndpointResourceTypeDto', () => {
  // ─── Valid payloads ─────────────────────────────────────────────────

  it('should pass validation with a complete valid payload', async () => {
    const dto = toDto(validPayload());
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should pass with only required fields (name, schemaUri, endpoint)', async () => {
    const dto = toDto({
      name: 'Printer',
      schemaUri: 'urn:example:printer:2.0',
      endpoint: '/Printers',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should pass with empty schemaExtensions array', async () => {
    const dto = toDto(validPayload({ schemaExtensions: [] }));
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should pass without optional description', async () => {
    const { description, ...rest } = validPayload();
    const dto = toDto(rest);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  // ─── name validation ─────────────────────────────────────────────────

  it('should fail when name is missing', async () => {
    const dto = toDto(validPayload({ name: undefined }));
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should fail when name is empty', async () => {
    const dto = toDto(validPayload({ name: '' }));
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should fail when name contains spaces', async () => {
    const dto = toDto(validPayload({ name: 'My Device' }));
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should fail when name starts with a number', async () => {
    const dto = toDto(validPayload({ name: '1Device' }));
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should fail when name contains special characters', async () => {
    const dto = toDto(validPayload({ name: 'Dev-ice' }));
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should pass when name is alphanumeric starting with letter', async () => {
    const dto = toDto(validPayload({ name: 'DeviceV2' }));
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  // ─── endpoint validation ──────────────────────────────────────────────

  it('should fail when endpoint is missing', async () => {
    const dto = toDto(validPayload({ endpoint: undefined }));
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should fail when endpoint does not start with /', async () => {
    const dto = toDto(validPayload({ endpoint: 'Devices' }));
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should fail when endpoint is just /', async () => {
    const dto = toDto(validPayload({ endpoint: '/' }));
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should fail when endpoint contains special characters', async () => {
    const dto = toDto(validPayload({ endpoint: '/Dev-ices' }));
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  // ─── schemaUri validation ─────────────────────────────────────────────

  it('should fail when schemaUri is missing', async () => {
    const dto = toDto(validPayload({ schemaUri: undefined }));
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should fail when schemaUri is empty', async () => {
    const dto = toDto(validPayload({ schemaUri: '' }));
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  // ─── description validation ───────────────────────────────────────────

  it('should pass with a long description within max length', async () => {
    const dto = toDto(validPayload({ description: 'A'.repeat(1024) }));
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should fail with description exceeding max length', async () => {
    const dto = toDto(validPayload({ description: 'A'.repeat(1025) }));
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
