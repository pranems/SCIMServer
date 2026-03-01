import { ScimMetadataService } from './scim-metadata.service';

describe('ScimMetadataService', () => {
  let service: ScimMetadataService;

  beforeEach(() => {
    service = new ScimMetadataService();
  });

  describe('buildLocation', () => {
    it('should build a SCIM resource location URL', () => {
      const result = service.buildLocation('https://example.com/scim/v2', 'Users', 'abc-123');
      expect(result).toBe('https://example.com/scim/v2/Users/abc-123');
    });

    it('should strip trailing slash from baseUrl', () => {
      const result = service.buildLocation('https://example.com/scim/v2/', 'Users', 'abc-123');
      expect(result).toBe('https://example.com/scim/v2/Users/abc-123');
    });

    it('should handle baseUrl without trailing slash', () => {
      const result = service.buildLocation('http://localhost:3000/scim/v2', 'Groups', 'group-1');
      expect(result).toBe('http://localhost:3000/scim/v2/Groups/group-1');
    });

    it('should work with different resource types', () => {
      expect(service.buildLocation('http://host/scim/v2', 'Users', 'u1'))
        .toBe('http://host/scim/v2/Users/u1');
      expect(service.buildLocation('http://host/scim/v2', 'Groups', 'g1'))
        .toBe('http://host/scim/v2/Groups/g1');
    });

    it('should handle UUIDs as IDs', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const result = service.buildLocation('https://api.example.com/scim/v2', 'Users', uuid);
      expect(result).toBe(`https://api.example.com/scim/v2/Users/${uuid}`);
    });
  });

  describe('currentIsoTimestamp', () => {
    it('should return a valid ISO 8601 timestamp', () => {
      const result = service.currentIsoTimestamp();
      // ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should return a timestamp close to now', () => {
      const before = Date.now();
      const result = service.currentIsoTimestamp();
      const after = Date.now();
      const ts = new Date(result).getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });
  });
});
