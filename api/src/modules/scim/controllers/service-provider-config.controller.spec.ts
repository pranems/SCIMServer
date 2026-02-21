import { ServiceProviderConfigController } from './service-provider-config.controller';

describe('ServiceProviderConfigController', () => {
  let controller: ServiceProviderConfigController;

  beforeEach(() => {
    controller = new ServiceProviderConfigController();
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

    it('should report bulk as not supported', () => {
      const result = controller.getConfig();
      expect(result.bulk.supported).toBe(false);
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

    it('should report sort as not supported', () => {
      const result = controller.getConfig();
      expect(result.sort.supported).toBe(false);
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
      expect(result.authenticationSchemes[0].specificationUrl).toContain('rfc6750');
    });
  });
});
