import { InMemoryEndpointSchemaRepository } from './inmemory-endpoint-schema.repository';
import type { EndpointSchemaCreateInput } from '../../../domain/models/endpoint-schema.model';

describe('InMemoryEndpointSchemaRepository', () => {
  let repo: InMemoryEndpointSchemaRepository;

  const sampleInput: EndpointSchemaCreateInput = {
    endpointId: 'ep-1',
    schemaUrn: 'urn:ietf:params:scim:schemas:extension:custom:2.0:User',
    name: 'Custom User Extension',
    description: 'Test extension',
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
  };

  beforeEach(() => {
    repo = new InMemoryEndpointSchemaRepository();
  });

  describe('create', () => {
    it('should create a record with generated id and timestamps', async () => {
      const record = await repo.create(sampleInput);

      expect(record.id).toBeDefined();
      expect(record.endpointId).toBe(sampleInput.endpointId);
      expect(record.schemaUrn).toBe(sampleInput.schemaUrn);
      expect(record.name).toBe(sampleInput.name);
      expect(record.description).toBe(sampleInput.description);
      expect(record.resourceTypeId).toBe(sampleInput.resourceTypeId);
      expect(record.required).toBe(false);
      expect(record.attributes).toEqual(sampleInput.attributes);
      expect(record.createdAt).toBeInstanceOf(Date);
      expect(record.updatedAt).toBeInstanceOf(Date);
    });

    it('should enforce unique constraint on [endpointId, schemaUrn]', async () => {
      await repo.create(sampleInput);
      await expect(repo.create(sampleInput)).rejects.toThrow('already exists');
    });

    it('should allow same URN for different endpoints', async () => {
      await repo.create(sampleInput);
      const second = await repo.create({ ...sampleInput, endpointId: 'ep-2' });
      expect(second.endpointId).toBe('ep-2');
    });

    it('should default description and resourceTypeId to null when omitted', async () => {
      const input: EndpointSchemaCreateInput = {
        endpointId: 'ep-1',
        schemaUrn: 'urn:test:minimal',
        name: 'Minimal',
        description: null,
        resourceTypeId: null,
        required: false,
        attributes: [],
      };
      const record = await repo.create(input);
      expect(record.description).toBeNull();
      expect(record.resourceTypeId).toBeNull();
    });
  });

  describe('findByEndpointId', () => {
    it('should return schemas for the given endpoint', async () => {
      await repo.create(sampleInput);
      await repo.create({
        ...sampleInput,
        schemaUrn: 'urn:test:second',
        name: 'Second',
      });
      await repo.create({ ...sampleInput, endpointId: 'ep-2' });

      const results = await repo.findByEndpointId('ep-1');
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.endpointId === 'ep-1')).toBe(true);
    });

    it('should return empty array for unknown endpoint', async () => {
      const results = await repo.findByEndpointId('unknown');
      expect(results).toEqual([]);
    });

    it('should return results sorted by createdAt', async () => {
      await repo.create(sampleInput);
      await repo.create({
        ...sampleInput,
        schemaUrn: 'urn:test:later',
        name: 'Later',
      });

      const results = await repo.findByEndpointId('ep-1');
      expect(results[0].createdAt.getTime()).toBeLessThanOrEqual(
        results[1].createdAt.getTime(),
      );
    });
  });

  describe('findAll', () => {
    it('should return all schemas across endpoints', async () => {
      await repo.create(sampleInput);
      await repo.create({ ...sampleInput, endpointId: 'ep-2' });

      const all = await repo.findAll();
      expect(all).toHaveLength(2);
    });

    it('should return empty array when no schemas exist', async () => {
      expect(await repo.findAll()).toEqual([]);
    });
  });

  describe('findByEndpointAndUrn', () => {
    it('should find a specific schema by endpoint and URN', async () => {
      await repo.create(sampleInput);
      const found = await repo.findByEndpointAndUrn(
        'ep-1',
        sampleInput.schemaUrn,
      );
      expect(found).not.toBeNull();
      expect(found!.schemaUrn).toBe(sampleInput.schemaUrn);
    });

    it('should return null for non-existent combination', async () => {
      const found = await repo.findByEndpointAndUrn('ep-1', 'urn:not:found');
      expect(found).toBeNull();
    });
  });

  describe('deleteByEndpointAndUrn', () => {
    it('should delete a specific schema and return true', async () => {
      await repo.create(sampleInput);
      const deleted = await repo.deleteByEndpointAndUrn(
        'ep-1',
        sampleInput.schemaUrn,
      );
      expect(deleted).toBe(true);

      const found = await repo.findByEndpointAndUrn(
        'ep-1',
        sampleInput.schemaUrn,
      );
      expect(found).toBeNull();
    });

    it('should return false for non-existent combination', async () => {
      const deleted = await repo.deleteByEndpointAndUrn(
        'ep-1',
        'urn:not:found',
      );
      expect(deleted).toBe(false);
    });
  });

  describe('deleteByEndpointId', () => {
    it('should delete all schemas for an endpoint and return count', async () => {
      await repo.create(sampleInput);
      await repo.create({
        ...sampleInput,
        schemaUrn: 'urn:test:second',
        name: 'Second',
      });
      await repo.create({ ...sampleInput, endpointId: 'ep-2' });

      const count = await repo.deleteByEndpointId('ep-1');
      expect(count).toBe(2);

      // ep-2's schema should still exist
      const remaining = await repo.findAll();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].endpointId).toBe('ep-2');
    });

    it('should return 0 if endpoint has no schemas', async () => {
      const count = await repo.deleteByEndpointId('unknown');
      expect(count).toBe(0);
    });
  });
});
