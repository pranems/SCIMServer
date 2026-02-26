import { InMemoryGenericResourceRepository } from './inmemory-generic-resource.repository';
import type {
  GenericResourceCreateInput,
  GenericResourceRecord,
} from '../../../domain/models/generic-resource.model';

describe('InMemoryGenericResourceRepository', () => {
  let repo: InMemoryGenericResourceRepository;

  const endpointId = 'ep-gen-inmem';
  const resourceType = 'Device';

  const sampleInput: GenericResourceCreateInput = {
    endpointId,
    resourceType,
    scimId: 'scim-001',
    externalId: 'ext-001',
    displayName: 'Test Device',
    active: true,
    rawPayload: JSON.stringify({ displayName: 'Test Device', serial: 'SN-001' }),
    meta: JSON.stringify({
      resourceType: 'Device',
      created: '2025-01-01T00:00:00.000Z',
      lastModified: '2025-01-01T00:00:00.000Z',
    }),
  };

  beforeEach(() => {
    repo = new InMemoryGenericResourceRepository();
  });

  describe('create', () => {
    it('should create a record with auto-generated fields', async () => {
      const record = await repo.create(sampleInput);
      expect(record.id).toBeDefined();
      expect(record.endpointId).toBe(endpointId);
      expect(record.resourceType).toBe('Device');
      expect(record.scimId).toBe('scim-001');
      expect(record.externalId).toBe('ext-001');
      expect(record.displayName).toBe('Test Device');
      expect(record.active).toBe(true);
      expect(record.deletedAt).toBeNull();
      expect(record.version).toBe(1);
      expect(record.createdAt).toBeInstanceOf(Date);
    });
  });

  describe('findByScimId', () => {
    it('should find a record by endpointId + resourceType + scimId', async () => {
      await repo.create(sampleInput);
      const found = await repo.findByScimId(endpointId, resourceType, 'scim-001');
      expect(found).toBeDefined();
      expect(found!.scimId).toBe('scim-001');
    });

    it('should return null for wrong resourceType', async () => {
      await repo.create(sampleInput);
      const found = await repo.findByScimId(endpointId, 'WrongType', 'scim-001');
      expect(found).toBeNull();
    });

    it('should return null for wrong endpointId', async () => {
      await repo.create(sampleInput);
      const found = await repo.findByScimId('other-ep', resourceType, 'scim-001');
      expect(found).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should return all records for a given endpointId + resourceType', async () => {
      await repo.create(sampleInput);
      await repo.create({
        ...sampleInput,
        scimId: 'scim-002',
        externalId: 'ext-002',
        displayName: 'Device 2',
      });

      const records = await repo.findAll(endpointId, resourceType);
      expect(records).toHaveLength(2);
    });

    it('should not return records from different resource types', async () => {
      await repo.create(sampleInput);
      await repo.create({
        ...sampleInput,
        resourceType: 'Application',
        scimId: 'scim-app-001',
      });

      const devices = await repo.findAll(endpointId, 'Device');
      expect(devices).toHaveLength(1);
    });

    it('should apply dbFilter', async () => {
      await repo.create(sampleInput);
      await repo.create({
        ...sampleInput,
        scimId: 'scim-002',
        externalId: 'ext-002',
        displayName: 'Other Device',
      });

      const filtered = await repo.findAll(endpointId, resourceType, {
        displayName: 'Test Device',
      });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].displayName).toBe('Test Device');
    });
  });

  describe('update', () => {
    it('should update fields and increment version', async () => {
      const created = await repo.create(sampleInput);
      const updated = await repo.update(created.id, {
        displayName: 'Updated Device',
      });

      expect(updated).toBeDefined();
      expect(updated!.displayName).toBe('Updated Device');
      expect(updated!.version).toBe(2);
    });

    it('should throw for non-existent id', async () => {
      await expect(repo.update('non-existent', { displayName: 'X' })).rejects.toThrow(
        /not found/,
      );
    });
  });

  describe('delete', () => {
    it('should delete a record by id', async () => {
      const created = await repo.create(sampleInput);
      await repo.delete(created.id);

      const found = await repo.findByScimId(endpointId, resourceType, 'scim-001');
      expect(found).toBeNull();
    });

    it('should no-op for non-existent id (void return)', async () => {
      // delete returns void per interface contract
      await expect(repo.delete('non-existent')).resolves.toBeUndefined();
    });
  });

  describe('findByExternalId', () => {
    it('should find by externalId scoped to endpointId + resourceType', async () => {
      await repo.create(sampleInput);
      const found = await repo.findByExternalId(endpointId, resourceType, 'ext-001');
      expect(found).toBeDefined();
      expect(found!.externalId).toBe('ext-001');
    });

    it('should return null for wrong endpoint', async () => {
      await repo.create(sampleInput);
      const found = await repo.findByExternalId('other', resourceType, 'ext-001');
      expect(found).toBeNull();
    });
  });

  describe('findByDisplayName', () => {
    it('should find by displayName (case-insensitive)', async () => {
      await repo.create(sampleInput);
      const found = await repo.findByDisplayName(endpointId, resourceType, 'test device');
      expect(found).toBeDefined();
      expect(found!.displayName).toBe('Test Device');
    });

    it('should return null for non-matching displayName', async () => {
      await repo.create(sampleInput);
      const found = await repo.findByDisplayName(endpointId, resourceType, 'Non Existent');
      expect(found).toBeNull();
    });
  });
});
