import { ServiceProviderConfigController } from './service-provider-config.controller';
import { ScimDiscoveryService } from '../discovery/scim-discovery.service';
import { ScimSchemaRegistry } from '../discovery/scim-schema-registry';

describe('ServiceProviderConfigController', () => {
  let controller: ServiceProviderConfigController;

  beforeEach(() => {
    const registry = new ScimSchemaRegistry();
    const discoveryService = new ScimDiscoveryService(registry);
    controller = new ServiceProviderConfigController(discoveryService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getConfig', () => {
    it('should return ServiceProviderConfig with correct schema', () => {
      const result = controller.getConfig();
      expect(result.schemas).toEqual([
        'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig',
      ]);
    });

    it('should report patch as supported', () => {
      const result = controller.getConfig();
      expect(result.patch.supported).toBe(true);
    });

    it('should report bulk as supported', () => {
      const result = controller.getConfig();
      expect(result.bulk.supported).toBe(true);
    });

    it('should report filter as supported with maxResults', () => {
      const result = controller.getConfig();
      expect(result.filter.supported).toBe(true);
      expect(result.filter.maxResults).toBe(200);
    });

    it('should report changePassword as not supported', () => {
      const result = controller.getConfig();
      expect(result.changePassword.supported).toBe(false);
    });

    it('should report sort as supported', () => {
      const result = controller.getConfig();
      expect(result.sort.supported).toBe(true);
    });

    it('should report etag as supported', () => {
      const result = controller.getConfig();
      expect(result.etag.supported).toBe(true);
    });

    it('should include OAuth bearer token authentication scheme', () => {
      const result = controller.getConfig();
      expect(result.authenticationSchemes).toHaveLength(1);
      expect(result.authenticationSchemes[0].type).toBe('oauthbearertoken');
      expect(result.authenticationSchemes[0].name).toBe('OAuth Bearer Token');
      expect(result.authenticationSchemes[0].specUri).toContain('rfc6750');
    });

    it('should include primary:true on authentication scheme (D6 — RFC 7643 §5)', () => {
      const result = controller.getConfig();
      expect(result.authenticationSchemes[0].primary).toBe(true);
    });

    it('should include meta with resourceType (RFC 7644 §4)', () => {
      const result = controller.getConfig();
      expect(result.meta).toBeDefined();
      expect(result.meta.resourceType).toBe('ServiceProviderConfig');
    });

    it('should include documentationUri', () => {
      const result = controller.getConfig();
      expect(result.documentationUri).toBeDefined();
      expect(typeof result.documentationUri).toBe('string');
    });

    it('should include bulk maxOperations and maxPayloadSize', () => {
      const result = controller.getConfig();
      expect(result.bulk.maxOperations).toBe(1000);
      expect(result.bulk.maxPayloadSize).toBe(1048576);
    });
  });
});
