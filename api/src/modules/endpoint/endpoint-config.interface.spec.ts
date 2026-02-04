import {
  ENDPOINT_CONFIG_FLAGS,
  getConfigBoolean,
  getConfigString,
  validateEndpointConfig,
  DEFAULT_ENDPOINT_CONFIG,
  type EndpointConfig,
} from './endpoint-config.interface';

describe('endpoint-config.interface', () => {
  describe('ENDPOINT_CONFIG_FLAGS', () => {
    it('should have all expected config flag keys', () => {
      expect(ENDPOINT_CONFIG_FLAGS.MULTI_OP_PATCH_ADD_MULTIPLE_MEMBERS_TO_GROUP).toBe(
        'MultiOpPatchRequestAddMultipleMembersToGroup'
      );
      expect(ENDPOINT_CONFIG_FLAGS.EXCLUDE_META).toBe('excludeMeta');
      expect(ENDPOINT_CONFIG_FLAGS.EXCLUDE_SCHEMAS).toBe('excludeSchemas');
      expect(ENDPOINT_CONFIG_FLAGS.CUSTOM_SCHEMA_URN).toBe('customSchemaUrn');
      expect(ENDPOINT_CONFIG_FLAGS.INCLUDE_ENTERPRISE_SCHEMA).toBe('includeEnterpriseSchema');
      expect(ENDPOINT_CONFIG_FLAGS.STRICT_MODE).toBe('strictMode');
      expect(ENDPOINT_CONFIG_FLAGS.LEGACY_MODE).toBe('legacyMode');
      expect(ENDPOINT_CONFIG_FLAGS.CUSTOM_HEADERS).toBe('customHeaders');
    });
  });

  describe('getConfigBoolean', () => {
    it('should return false for undefined config', () => {
      expect(getConfigBoolean(undefined, 'anyKey')).toBe(false);
    });

    it('should return false for non-existent key', () => {
      const config: EndpointConfig = {};
      expect(getConfigBoolean(config, 'nonExistentKey')).toBe(false);
    });

    it('should return true for boolean true value', () => {
      const config: EndpointConfig = { testKey: true };
      expect(getConfigBoolean(config, 'testKey')).toBe(true);
    });

    it('should return false for boolean false value', () => {
      const config: EndpointConfig = { testKey: false };
      expect(getConfigBoolean(config, 'testKey')).toBe(false);
    });

    it('should return true for string "true"', () => {
      const config: EndpointConfig = { testKey: 'true' };
      expect(getConfigBoolean(config, 'testKey')).toBe(true);
    });

    it('should return true for string "True"', () => {
      const config: EndpointConfig = { testKey: 'True' };
      expect(getConfigBoolean(config, 'testKey')).toBe(true);
    });

    it('should return true for string "TRUE"', () => {
      const config: EndpointConfig = { testKey: 'TRUE' };
      expect(getConfigBoolean(config, 'testKey')).toBe(true);
    });

    it('should return false for string "false"', () => {
      const config: EndpointConfig = { testKey: 'false' };
      expect(getConfigBoolean(config, 'testKey')).toBe(false);
    });

    it('should return false for string "False"', () => {
      const config: EndpointConfig = { testKey: 'False' };
      expect(getConfigBoolean(config, 'testKey')).toBe(false);
    });

    it('should return true for string "1"', () => {
      const config: EndpointConfig = { testKey: '1' };
      expect(getConfigBoolean(config, 'testKey')).toBe(true);
    });

    it('should return false for string "0"', () => {
      const config: EndpointConfig = { testKey: '0' };
      expect(getConfigBoolean(config, 'testKey')).toBe(false);
    });

    it('should return false for other string values', () => {
      const config: EndpointConfig = { testKey: 'yes' };
      expect(getConfigBoolean(config, 'testKey')).toBe(false);
    });

    it('should return false for number values', () => {
      const config: EndpointConfig = { testKey: 123 };
      expect(getConfigBoolean(config, 'testKey')).toBe(false);
    });

    it('should return false for object values', () => {
      const config: EndpointConfig = { testKey: { enabled: true } };
      expect(getConfigBoolean(config, 'testKey')).toBe(false);
    });

    it('should work with MultiOpPatchRequestAddMultipleMembersToGroup flag', () => {
      const config: EndpointConfig = {
        [ENDPOINT_CONFIG_FLAGS.MULTI_OP_PATCH_ADD_MULTIPLE_MEMBERS_TO_GROUP]: 'True',
      };
      expect(
        getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.MULTI_OP_PATCH_ADD_MULTIPLE_MEMBERS_TO_GROUP)
      ).toBe(true);
    });
  });

  describe('getConfigString', () => {
    it('should return undefined for undefined config', () => {
      expect(getConfigString(undefined, 'anyKey')).toBeUndefined();
    });

    it('should return undefined for non-existent key', () => {
      const config: EndpointConfig = {};
      expect(getConfigString(config, 'nonExistentKey')).toBeUndefined();
    });

    it('should return string value', () => {
      const config: EndpointConfig = { testKey: 'testValue' };
      expect(getConfigString(config, 'testKey')).toBe('testValue');
    });

    it('should return undefined for boolean value', () => {
      const config: EndpointConfig = { testKey: true };
      expect(getConfigString(config, 'testKey')).toBeUndefined();
    });

    it('should return undefined for number value', () => {
      const config: EndpointConfig = { testKey: 123 };
      expect(getConfigString(config, 'testKey')).toBeUndefined();
    });

    it('should return undefined for object value', () => {
      const config: EndpointConfig = { testKey: { key: 'value' } };
      expect(getConfigString(config, 'testKey')).toBeUndefined();
    });

    it('should work with customSchemaUrn flag', () => {
      const config: EndpointConfig = {
        [ENDPOINT_CONFIG_FLAGS.CUSTOM_SCHEMA_URN]: 'urn:custom:scim',
      };
      expect(getConfigString(config, ENDPOINT_CONFIG_FLAGS.CUSTOM_SCHEMA_URN)).toBe(
        'urn:custom:scim'
      );
    });
  });

  describe('validateEndpointConfig', () => {
    it('should not throw for undefined config', () => {
      expect(() => validateEndpointConfig(undefined)).not.toThrow();
    });

    it('should not throw for empty config', () => {
      expect(() => validateEndpointConfig({})).not.toThrow();
    });

    describe('MultiOpPatchRequestAddMultipleMembersToGroup validation', () => {
      it('should accept boolean true', () => {
        expect(() =>
          validateEndpointConfig({ MultiOpPatchRequestAddMultipleMembersToGroup: true })
        ).not.toThrow();
      });

      it('should accept boolean false', () => {
        expect(() =>
          validateEndpointConfig({ MultiOpPatchRequestAddMultipleMembersToGroup: false })
        ).not.toThrow();
      });

      it('should accept string "true"', () => {
        expect(() =>
          validateEndpointConfig({ MultiOpPatchRequestAddMultipleMembersToGroup: 'true' })
        ).not.toThrow();
      });

      it('should accept string "True"', () => {
        expect(() =>
          validateEndpointConfig({ MultiOpPatchRequestAddMultipleMembersToGroup: 'True' })
        ).not.toThrow();
      });

      it('should accept string "false"', () => {
        expect(() =>
          validateEndpointConfig({ MultiOpPatchRequestAddMultipleMembersToGroup: 'false' })
        ).not.toThrow();
      });

      it('should accept string "False"', () => {
        expect(() =>
          validateEndpointConfig({ MultiOpPatchRequestAddMultipleMembersToGroup: 'False' })
        ).not.toThrow();
      });

      it('should accept string "1"', () => {
        expect(() =>
          validateEndpointConfig({ MultiOpPatchRequestAddMultipleMembersToGroup: '1' })
        ).not.toThrow();
      });

      it('should accept string "0"', () => {
        expect(() =>
          validateEndpointConfig({ MultiOpPatchRequestAddMultipleMembersToGroup: '0' })
        ).not.toThrow();
      });

      it('should throw for invalid string "Yes"', () => {
        expect(() =>
          validateEndpointConfig({ MultiOpPatchRequestAddMultipleMembersToGroup: 'Yes' })
        ).toThrow(/Invalid value/);
      });

      it('should throw for invalid string "No"', () => {
        expect(() =>
          validateEndpointConfig({ MultiOpPatchRequestAddMultipleMembersToGroup: 'No' })
        ).toThrow(/Invalid value/);
      });

      it('should throw for invalid string "enabled"', () => {
        expect(() =>
          validateEndpointConfig({ MultiOpPatchRequestAddMultipleMembersToGroup: 'enabled' })
        ).toThrow(/Invalid value/);
      });

      it('should throw for number value', () => {
        expect(() =>
          validateEndpointConfig({ MultiOpPatchRequestAddMultipleMembersToGroup: 123 })
        ).toThrow(/Invalid type/);
      });

      it('should throw for object value', () => {
        expect(() =>
          validateEndpointConfig({ MultiOpPatchRequestAddMultipleMembersToGroup: { enabled: true } })
        ).toThrow(/Invalid type/);
      });

      it('should throw for array value', () => {
        expect(() =>
          validateEndpointConfig({ MultiOpPatchRequestAddMultipleMembersToGroup: ['true'] })
        ).toThrow(/Invalid type/);
      });

      it('should include flag name in error message', () => {
        try {
          validateEndpointConfig({ MultiOpPatchRequestAddMultipleMembersToGroup: 'invalid' });
          fail('Expected error');
        } catch (e) {
          expect((e as Error).message).toContain('MultiOpPatchRequestAddMultipleMembersToGroup');
        }
      });

      it('should include allowed values in error message', () => {
        try {
          validateEndpointConfig({ MultiOpPatchRequestAddMultipleMembersToGroup: 'invalid' });
          fail('Expected error');
        } catch (e) {
          expect((e as Error).message).toContain('Allowed values');
        }
      });
    });

    it('should not validate other config flags (yet)', () => {
      // Other flags are not validated yet, so they should pass
      expect(() =>
        validateEndpointConfig({
          excludeMeta: 'invalid',
          strictMode: 123,
          customHeaders: 'not-an-object',
        })
      ).not.toThrow();
    });
  });

  describe('DEFAULT_ENDPOINT_CONFIG', () => {
    it('should have expected default values', () => {
      expect(DEFAULT_ENDPOINT_CONFIG[ENDPOINT_CONFIG_FLAGS.MULTI_OP_PATCH_ADD_MULTIPLE_MEMBERS_TO_GROUP]).toBe(false);
      expect(DEFAULT_ENDPOINT_CONFIG[ENDPOINT_CONFIG_FLAGS.EXCLUDE_META]).toBe(false);
      expect(DEFAULT_ENDPOINT_CONFIG[ENDPOINT_CONFIG_FLAGS.EXCLUDE_SCHEMAS]).toBe(false);
      expect(DEFAULT_ENDPOINT_CONFIG[ENDPOINT_CONFIG_FLAGS.INCLUDE_ENTERPRISE_SCHEMA]).toBe(false);
      expect(DEFAULT_ENDPOINT_CONFIG[ENDPOINT_CONFIG_FLAGS.STRICT_MODE]).toBe(false);
      expect(DEFAULT_ENDPOINT_CONFIG[ENDPOINT_CONFIG_FLAGS.LEGACY_MODE]).toBe(false);
    });
  });
});
