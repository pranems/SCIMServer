import { InMemoryEndpointResourceTypeRepository } from './inmemory-endpoint-resource-type.repository';
import type { EndpointResourceTypeCreateInput } from '../../../domain/models/endpoint-resource-type.model';

describe('InMemoryEndpointResourceTypeRepository', () => {
  let repo: InMemoryEndpointResourceTypeRepository;

  const endpointId = 'ep-inmem-1';

  const sampleInput: EndpointResourceTypeCreateInput = {
    endpointId,
    name: 'Device',
    description: 'IoT devices',
    schemaUri: 'urn:ietf:params:scim:schemas:core:2.0:Device',
    endpoint: '/Devices',
    schemaExtensions: [{ schema: 'urn:example:ext:device:2.0', required: false }],
  };

  beforeEach(() => {
    repo = new InMemoryEndpointResourceTypeRepository();
  });

  describe('create', () => {
    it('should create a record with a generated UUID', async () => {
      const record = await repo.create(sampleInput);
      expect(record.id).toBeDefined();
      expect(record.endpointId).toBe(endpointId);
      expect(record.name).toBe('Device');
      expect(record.schemaUri).toBe(sampleInput.schemaUri);
      expect(record.endpoint).toBe('/Devices');
      expect(record.active).toBe(true);
      expect(record.createdAt).toBeInstanceOf(Date);
    });

    it('should reject duplicate endpointId + name', async () => {
      await repo.create(sampleInput);
      await expect(repo.create(sampleInput)).rejects.toThrow(/already exists/);
    });

    it('should reject duplicate endpointId + endpoint path', async () => {
      await repo.create(sampleInput);
      await expect(
        repo.create({ ...sampleInput, name: 'OtherDevice' }),
      ).rejects.toThrow(/endpoint path/);
    });
  });

  describe('findByEndpointId', () => {
    it('should return all records for an endpoint', async () => {
      await repo.create(sampleInput);
      await repo.create({
        ...sampleInput,
        name: 'Application',
        endpoint: '/Applications',
        schemaUri: 'urn:example:app',
      });

      const records = await repo.findByEndpointId(endpointId);
      expect(records).toHaveLength(2);
    });

    it('should return empty for unknown endpoint', async () => {
      const records = await repo.findByEndpointId('unknown');
      expect(records).toEqual([]);
    });
  });

  describe('findAll', () => {
    it('should return all records across endpoints', async () => {
      await repo.create(sampleInput);
      await repo.create({
        ...sampleInput,
        endpointId: 'ep-2',
        name: 'Printer',
        endpoint: '/Printers',
      });

      const all = await repo.findAll();
      expect(all).toHaveLength(2);
    });
  });

  describe('findByEndpointAndName', () => {
    it('should find a specific record', async () => {
      await repo.create(sampleInput);
      const found = await repo.findByEndpointAndName(endpointId, 'Device');
      expect(found).toBeDefined();
      expect(found!.name).toBe('Device');
    });

    it('should return null for non-existent name', async () => {
      const found = await repo.findByEndpointAndName(endpointId, 'NonExistent');
      expect(found).toBeNull();
    });
  });

  describe('deleteByEndpointAndName', () => {
    it('should delete a record and return true', async () => {
      await repo.create(sampleInput);
      const deleted = await repo.deleteByEndpointAndName(endpointId, 'Device');
      expect(deleted).toBe(true);

      const found = await repo.findByEndpointAndName(endpointId, 'Device');
      expect(found).toBeNull();
    });

    it('should return false for non-existent record', async () => {
      const deleted = await repo.deleteByEndpointAndName(endpointId, 'NonExistent');
      expect(deleted).toBe(false);
    });
  });

  describe('deleteByEndpointId', () => {
    it('should delete all records for an endpoint', async () => {
      await repo.create(sampleInput);
      await repo.create({
        ...sampleInput,
        name: 'Application',
        endpoint: '/Applications',
        schemaUri: 'urn:example:app',
      });

      const count = await repo.deleteByEndpointId(endpointId);
      expect(count).toBe(2);

      const remaining = await repo.findByEndpointId(endpointId);
      expect(remaining).toEqual([]);
    });

    it('should return 0 for unknown endpoint', async () => {
      const count = await repo.deleteByEndpointId('unknown');
      expect(count).toBe(0);
    });
  });
});
