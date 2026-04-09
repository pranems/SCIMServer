import {
  ENDPOINT_CONFIG_FLAGS,
  getConfigBoolean,
  getConfigBooleanWithDefault,
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
      expect(ENDPOINT_CONFIG_FLAGS.MULTI_OP_PATCH_REMOVE_MULTIPLE_MEMBERS_FROM_GROUP).toBe(
        'MultiOpPatchRequestRemoveMultipleMembersFromGroup'
      );
      expect(ENDPOINT_CONFIG_FLAGS.PATCH_OP_ALLOW_REMOVE_ALL_MEMBERS).toBe(
        'PatchOpAllowRemoveAllMembers'
      );
      expect(ENDPOINT_CONFIG_FLAGS.VERBOSE_PATCH_SUPPORTED).toBe('VerbosePatchSupported');
      expect(ENDPOINT_CONFIG_FLAGS.LOG_LEVEL).toBe('logLevel');
      expect(ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED).toBe('SoftDeleteEnabled');
      expect(ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION).toBe('StrictSchemaValidation');
      expect(ENDPOINT_CONFIG_FLAGS.REQUIRE_IF_MATCH).toBe('RequireIfMatch');
      expect(ENDPOINT_CONFIG_FLAGS.ALLOW_AND_COERCE_BOOLEAN_STRINGS).toBe('AllowAndCoerceBooleanStrings');
      expect(ENDPOINT_CONFIG_FLAGS.REPROVISION_ON_CONFLICT_FOR_SOFT_DELETED).toBe('ReprovisionOnConflictForSoftDeletedResource');
      expect(ENDPOINT_CONFIG_FLAGS.CUSTOM_RESOURCE_TYPES_ENABLED).toBe('CustomResourceTypesEnabled');
      expect(ENDPOINT_CONFIG_FLAGS.BULK_OPERATIONS_ENABLED).toBe('BulkOperationsEnabled');
      expect(ENDPOINT_CONFIG_FLAGS.PER_ENDPOINT_CREDENTIALS_ENABLED).toBe('PerEndpointCredentialsEnabled');
      expect(ENDPOINT_CONFIG_FLAGS.INCLUDE_WARNING_ABOUT_IGNORED_READONLY_ATTRIBUTE).toBe('IncludeWarningAboutIgnoredReadOnlyAttribute');
      expect(ENDPOINT_CONFIG_FLAGS.IGNORE_READONLY_ATTRIBUTES_IN_PATCH).toBe('IgnoreReadOnlyAttributesInPatch');
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

    it('should work with custom string flags', () => {
      const config: EndpointConfig = {
        customFlag: 'custom-value',
      };
      expect(getConfigString(config, 'customFlag')).toBe(
        'custom-value'
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

    describe('MultiOpPatchRequestRemoveMultipleMembersFromGroup validation', () => {
      it('should accept boolean true', () => {
        expect(() =>
          validateEndpointConfig({ MultiOpPatchRequestRemoveMultipleMembersFromGroup: true })
        ).not.toThrow();
      });

      it('should accept boolean false', () => {
        expect(() =>
          validateEndpointConfig({ MultiOpPatchRequestRemoveMultipleMembersFromGroup: false })
        ).not.toThrow();
      });

      it('should accept string "true"', () => {
        expect(() =>
          validateEndpointConfig({ MultiOpPatchRequestRemoveMultipleMembersFromGroup: 'true' })
        ).not.toThrow();
      });

      it('should accept string "True"', () => {
        expect(() =>
          validateEndpointConfig({ MultiOpPatchRequestRemoveMultipleMembersFromGroup: 'True' })
        ).not.toThrow();
      });

      it('should accept string "false"', () => {
        expect(() =>
          validateEndpointConfig({ MultiOpPatchRequestRemoveMultipleMembersFromGroup: 'false' })
        ).not.toThrow();
      });

      it('should accept string "False"', () => {
        expect(() =>
          validateEndpointConfig({ MultiOpPatchRequestRemoveMultipleMembersFromGroup: 'False' })
        ).not.toThrow();
      });

      it('should accept string "1"', () => {
        expect(() =>
          validateEndpointConfig({ MultiOpPatchRequestRemoveMultipleMembersFromGroup: '1' })
        ).not.toThrow();
      });

      it('should accept string "0"', () => {
        expect(() =>
          validateEndpointConfig({ MultiOpPatchRequestRemoveMultipleMembersFromGroup: '0' })
        ).not.toThrow();
      });

      it('should throw for invalid string "Yes"', () => {
        expect(() =>
          validateEndpointConfig({ MultiOpPatchRequestRemoveMultipleMembersFromGroup: 'Yes' })
        ).toThrow(/Invalid value/);
      });

      it('should throw for invalid string "No"', () => {
        expect(() =>
          validateEndpointConfig({ MultiOpPatchRequestRemoveMultipleMembersFromGroup: 'No' })
        ).toThrow(/Invalid value/);
      });

      it('should throw for invalid string "enabled"', () => {
        expect(() =>
          validateEndpointConfig({ MultiOpPatchRequestRemoveMultipleMembersFromGroup: 'enabled' })
        ).toThrow(/Invalid value/);
      });

      it('should throw for number value', () => {
        expect(() =>
          validateEndpointConfig({ MultiOpPatchRequestRemoveMultipleMembersFromGroup: 123 })
        ).toThrow(/Invalid type/);
      });

      it('should throw for object value', () => {
        expect(() =>
          validateEndpointConfig({ MultiOpPatchRequestRemoveMultipleMembersFromGroup: { enabled: true } })
        ).toThrow(/Invalid type/);
      });

      it('should throw for array value', () => {
        expect(() =>
          validateEndpointConfig({ MultiOpPatchRequestRemoveMultipleMembersFromGroup: ['true'] })
        ).toThrow(/Invalid type/);
      });

      it('should include flag name in error message', () => {
        try {
          validateEndpointConfig({ MultiOpPatchRequestRemoveMultipleMembersFromGroup: 'invalid' });
          fail('Expected error');
        } catch (e) {
          expect((e as Error).message).toContain('MultiOpPatchRequestRemoveMultipleMembersFromGroup');
        }
      });

      it('should include allowed values in error message', () => {
        try {
          validateEndpointConfig({ MultiOpPatchRequestRemoveMultipleMembersFromGroup: 'invalid' });
          fail('Expected error');
        } catch (e) {
          expect((e as Error).message).toContain('Allowed values');
        }
      });
    });

    describe('Both flags together', () => {
      it('should accept both flags set to valid values', () => {
        expect(() =>
          validateEndpointConfig({
            MultiOpPatchRequestAddMultipleMembersToGroup: 'True',
            MultiOpPatchRequestRemoveMultipleMembersFromGroup: 'True',
          })
        ).not.toThrow();
      });

      it('should reject if add flag is invalid even if remove flag is valid', () => {
        expect(() =>
          validateEndpointConfig({
            MultiOpPatchRequestAddMultipleMembersToGroup: 'invalid',
            MultiOpPatchRequestRemoveMultipleMembersFromGroup: 'True',
          })
        ).toThrow(/MultiOpPatchRequestAddMultipleMembersToGroup/);
      });

      it('should reject if remove flag is invalid even if add flag is valid', () => {
        expect(() =>
          validateEndpointConfig({
            MultiOpPatchRequestAddMultipleMembersToGroup: 'True',
            MultiOpPatchRequestRemoveMultipleMembersFromGroup: 'invalid',
          })
        ).toThrow(/MultiOpPatchRequestRemoveMultipleMembersFromGroup/);
      });
    });

    describe('PatchOpAllowRemoveAllMembers validation', () => {
      it('should accept boolean true', () => {
        expect(() =>
          validateEndpointConfig({ PatchOpAllowRemoveAllMembers: true })
        ).not.toThrow();
      });

      it('should accept boolean false', () => {
        expect(() =>
          validateEndpointConfig({ PatchOpAllowRemoveAllMembers: false })
        ).not.toThrow();
      });

      it('should accept string "true"', () => {
        expect(() =>
          validateEndpointConfig({ PatchOpAllowRemoveAllMembers: 'true' })
        ).not.toThrow();
      });

      it('should accept string "True"', () => {
        expect(() =>
          validateEndpointConfig({ PatchOpAllowRemoveAllMembers: 'True' })
        ).not.toThrow();
      });

      it('should accept string "false"', () => {
        expect(() =>
          validateEndpointConfig({ PatchOpAllowRemoveAllMembers: 'false' })
        ).not.toThrow();
      });

      it('should accept string "False"', () => {
        expect(() =>
          validateEndpointConfig({ PatchOpAllowRemoveAllMembers: 'False' })
        ).not.toThrow();
      });

      it('should accept string "1"', () => {
        expect(() =>
          validateEndpointConfig({ PatchOpAllowRemoveAllMembers: '1' })
        ).not.toThrow();
      });

      it('should accept string "0"', () => {
        expect(() =>
          validateEndpointConfig({ PatchOpAllowRemoveAllMembers: '0' })
        ).not.toThrow();
      });

      it('should throw for invalid string "Yes"', () => {
        expect(() =>
          validateEndpointConfig({ PatchOpAllowRemoveAllMembers: 'Yes' })
        ).toThrow(/Invalid value/);
      });

      it('should throw for invalid string "No"', () => {
        expect(() =>
          validateEndpointConfig({ PatchOpAllowRemoveAllMembers: 'No' })
        ).toThrow(/Invalid value/);
      });

      it('should throw for number value', () => {
        expect(() =>
          validateEndpointConfig({ PatchOpAllowRemoveAllMembers: 123 })
        ).toThrow(/Invalid type/);
      });

      it('should throw for object value', () => {
        expect(() =>
          validateEndpointConfig({ PatchOpAllowRemoveAllMembers: { enabled: true } })
        ).toThrow(/Invalid type/);
      });

      it('should include flag name in error message', () => {
        try {
          validateEndpointConfig({ PatchOpAllowRemoveAllMembers: 'invalid' });
          fail('Expected error');
        } catch (e) {
          expect((e as Error).message).toContain('PatchOpAllowRemoveAllMembers');
        }
      });
    });

    describe('VerbosePatchSupported validation', () => {
      it('should accept boolean true', () => {
        expect(() =>
          validateEndpointConfig({ VerbosePatchSupported: true })
        ).not.toThrow();
      });

      it('should accept boolean false', () => {
        expect(() =>
          validateEndpointConfig({ VerbosePatchSupported: false })
        ).not.toThrow();
      });

      it('should accept string "true"', () => {
        expect(() =>
          validateEndpointConfig({ VerbosePatchSupported: 'true' })
        ).not.toThrow();
      });

      it('should accept string "True"', () => {
        expect(() =>
          validateEndpointConfig({ VerbosePatchSupported: 'True' })
        ).not.toThrow();
      });

      it('should accept string "false"', () => {
        expect(() =>
          validateEndpointConfig({ VerbosePatchSupported: 'false' })
        ).not.toThrow();
      });

      it('should accept string "False"', () => {
        expect(() =>
          validateEndpointConfig({ VerbosePatchSupported: 'False' })
        ).not.toThrow();
      });

      it('should accept string "1"', () => {
        expect(() =>
          validateEndpointConfig({ VerbosePatchSupported: '1' })
        ).not.toThrow();
      });

      it('should accept string "0"', () => {
        expect(() =>
          validateEndpointConfig({ VerbosePatchSupported: '0' })
        ).not.toThrow();
      });

      it('should throw for invalid string "Yes"', () => {
        expect(() =>
          validateEndpointConfig({ VerbosePatchSupported: 'Yes' })
        ).toThrow(/Invalid value/);
      });

      it('should throw for invalid string "No"', () => {
        expect(() =>
          validateEndpointConfig({ VerbosePatchSupported: 'No' })
        ).toThrow(/Invalid value/);
      });

      it('should throw for number value', () => {
        expect(() =>
          validateEndpointConfig({ VerbosePatchSupported: 123 })
        ).toThrow(/Invalid type/);
      });

      it('should throw for object value', () => {
        expect(() =>
          validateEndpointConfig({ VerbosePatchSupported: { enabled: true } })
        ).toThrow(/Invalid type/);
      });

      it('should throw for array value', () => {
        expect(() =>
          validateEndpointConfig({ VerbosePatchSupported: ['true'] })
        ).toThrow(/Invalid type/);
      });

      it('should include flag name in error message', () => {
        try {
          validateEndpointConfig({ VerbosePatchSupported: 'invalid' });
          fail('Expected error');
        } catch (e) {
          expect((e as Error).message).toContain('VerbosePatchSupported');
        }
      });

      it('should include allowed values in error message', () => {
        try {
          validateEndpointConfig({ VerbosePatchSupported: 'invalid' });
          fail('Expected error');
        } catch (e) {
          expect((e as Error).message).toContain('Allowed values');
        }
      });
    });

    describe('logLevel validation', () => {
      it('should accept string "TRACE"', () => {
        expect(() => validateEndpointConfig({ logLevel: 'TRACE' })).not.toThrow();
      });

      it('should accept string "DEBUG"', () => {
        expect(() => validateEndpointConfig({ logLevel: 'DEBUG' })).not.toThrow();
      });

      it('should accept string "INFO"', () => {
        expect(() => validateEndpointConfig({ logLevel: 'INFO' })).not.toThrow();
      });

      it('should accept string "WARN"', () => {
        expect(() => validateEndpointConfig({ logLevel: 'WARN' })).not.toThrow();
      });

      it('should accept string "ERROR"', () => {
        expect(() => validateEndpointConfig({ logLevel: 'ERROR' })).not.toThrow();
      });

      it('should accept string "FATAL"', () => {
        expect(() => validateEndpointConfig({ logLevel: 'FATAL' })).not.toThrow();
      });

      it('should accept string "OFF"', () => {
        expect(() => validateEndpointConfig({ logLevel: 'OFF' })).not.toThrow();
      });

      it('should accept lowercase "debug"', () => {
        expect(() => validateEndpointConfig({ logLevel: 'debug' })).not.toThrow();
      });

      it('should accept mixed-case "Info"', () => {
        expect(() => validateEndpointConfig({ logLevel: 'Info' })).not.toThrow();
      });

      it('should accept numeric 0 (TRACE)', () => {
        expect(() => validateEndpointConfig({ logLevel: 0 })).not.toThrow();
      });

      it('should accept numeric 2 (INFO)', () => {
        expect(() => validateEndpointConfig({ logLevel: 2 })).not.toThrow();
      });

      it('should accept numeric 6 (OFF)', () => {
        expect(() => validateEndpointConfig({ logLevel: 6 })).not.toThrow();
      });

      it('should throw for invalid string "VERBOSE"', () => {
        expect(() => validateEndpointConfig({ logLevel: 'VERBOSE' })).toThrow(/Invalid value/);
      });

      it('should throw for invalid string "high"', () => {
        expect(() => validateEndpointConfig({ logLevel: 'high' })).toThrow(/Invalid value/);
      });

      it('should throw for empty string', () => {
        expect(() => validateEndpointConfig({ logLevel: '' })).toThrow(/Invalid value/);
      });

      it('should throw for numeric -1 (out of range)', () => {
        expect(() => validateEndpointConfig({ logLevel: -1 })).toThrow(/Invalid numeric value/);
      });

      it('should throw for numeric 7 (out of range)', () => {
        expect(() => validateEndpointConfig({ logLevel: 7 })).toThrow(/Invalid numeric value/);
      });

      it('should throw for numeric 1.5 (not integer)', () => {
        expect(() => validateEndpointConfig({ logLevel: 1.5 })).toThrow(/Invalid numeric value/);
      });

      it('should throw for boolean value', () => {
        expect(() => validateEndpointConfig({ logLevel: true })).toThrow(/Invalid type/);
      });

      it('should throw for object value', () => {
        expect(() => validateEndpointConfig({ logLevel: { level: 'DEBUG' } })).toThrow(/Invalid type/);
      });

      it('should throw for array value', () => {
        expect(() => validateEndpointConfig({ logLevel: ['DEBUG'] })).toThrow(/Invalid type/);
      });

      it('should include flag name in error message', () => {
        try {
          validateEndpointConfig({ logLevel: 'invalid' });
          fail('Expected error');
        } catch (e) {
          expect((e as Error).message).toContain('logLevel');
        }
      });

      it('should include allowed values in error message for invalid string', () => {
        try {
          validateEndpointConfig({ logLevel: 'invalid' });
          fail('Expected error');
        } catch (e) {
          expect((e as Error).message).toContain('TRACE');
          expect((e as Error).message).toContain('OFF');
        }
      });

      it('should work alongside other config flags', () => {
        expect(() =>
          validateEndpointConfig({
            logLevel: 'DEBUG',
            MultiOpPatchRequestAddMultipleMembersToGroup: 'True',
            VerbosePatchSupported: false,
          })
        ).not.toThrow();
      });

      it('should not be present in config by default (undefined)', () => {
        expect(() => validateEndpointConfig({ logLevel: undefined })).not.toThrow();
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
    it('should have expected default values (settings v7)', () => {
      expect(DEFAULT_ENDPOINT_CONFIG[ENDPOINT_CONFIG_FLAGS.USER_SOFT_DELETE_ENABLED]).toBe(true);
      expect(DEFAULT_ENDPOINT_CONFIG[ENDPOINT_CONFIG_FLAGS.USER_HARD_DELETE_ENABLED]).toBe(true);
      expect(DEFAULT_ENDPOINT_CONFIG[ENDPOINT_CONFIG_FLAGS.GROUP_HARD_DELETE_ENABLED]).toBe(true);
      expect(DEFAULT_ENDPOINT_CONFIG[ENDPOINT_CONFIG_FLAGS.MULTI_MEMBER_PATCH_OP_FOR_GROUP_ENABLED]).toBe(true);
      expect(DEFAULT_ENDPOINT_CONFIG[ENDPOINT_CONFIG_FLAGS.SCHEMA_DISCOVERY_ENABLED]).toBe(true);
      expect(DEFAULT_ENDPOINT_CONFIG[ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]).toBe(true);
      expect(DEFAULT_ENDPOINT_CONFIG[ENDPOINT_CONFIG_FLAGS.PATCH_OP_ALLOW_REMOVE_ALL_MEMBERS]).toBe(false);
      expect(DEFAULT_ENDPOINT_CONFIG[ENDPOINT_CONFIG_FLAGS.VERBOSE_PATCH_SUPPORTED]).toBe(false);
      expect(DEFAULT_ENDPOINT_CONFIG[ENDPOINT_CONFIG_FLAGS.REQUIRE_IF_MATCH]).toBe(false);
      expect(DEFAULT_ENDPOINT_CONFIG[ENDPOINT_CONFIG_FLAGS.ALLOW_AND_COERCE_BOOLEAN_STRINGS]).toBe(true);
    });
  });

  describe('SoftDeleteEnabled validation', () => {
    it('should accept boolean true', () => {
      expect(() => validateEndpointConfig({ SoftDeleteEnabled: true })).not.toThrow();
    });

    it('should accept boolean false', () => {
      expect(() => validateEndpointConfig({ SoftDeleteEnabled: false })).not.toThrow();
    });

    it('should accept string "True"', () => {
      expect(() => validateEndpointConfig({ SoftDeleteEnabled: 'True' })).not.toThrow();
    });

    it('should accept string "true"', () => {
      expect(() => validateEndpointConfig({ SoftDeleteEnabled: 'true' })).not.toThrow();
    });

    it('should accept string "False"', () => {
      expect(() => validateEndpointConfig({ SoftDeleteEnabled: 'False' })).not.toThrow();
    });

    it('should accept string "false"', () => {
      expect(() => validateEndpointConfig({ SoftDeleteEnabled: 'false' })).not.toThrow();
    });

    it('should accept string "1"', () => {
      expect(() => validateEndpointConfig({ SoftDeleteEnabled: '1' })).not.toThrow();
    });

    it('should accept string "0"', () => {
      expect(() => validateEndpointConfig({ SoftDeleteEnabled: '0' })).not.toThrow();
    });

    it('should throw for invalid string "Yes"', () => {
      expect(() => validateEndpointConfig({ SoftDeleteEnabled: 'Yes' })).toThrow(/Invalid value/);
    });

    it('should throw for invalid string "No"', () => {
      expect(() => validateEndpointConfig({ SoftDeleteEnabled: 'No' })).toThrow(/Invalid value/);
    });

    it('should throw for number value', () => {
      expect(() => validateEndpointConfig({ SoftDeleteEnabled: 123 })).toThrow(/Invalid type/);
    });

    it('should throw for object value', () => {
      expect(() => validateEndpointConfig({ SoftDeleteEnabled: { enabled: true } })).toThrow(/Invalid type/);
    });

    it('should throw for array value', () => {
      expect(() => validateEndpointConfig({ SoftDeleteEnabled: ['true'] })).toThrow(/Invalid type/);
    });

    it('should include flag name in error message', () => {
      try {
        validateEndpointConfig({ SoftDeleteEnabled: 'invalid' });
        fail('Expected error');
      } catch (e) {
        expect((e as Error).message).toContain('SoftDeleteEnabled');
      }
    });

    it('should include allowed values in error message', () => {
      try {
        validateEndpointConfig({ SoftDeleteEnabled: 'invalid' });
        fail('Expected error');
      } catch (e) {
        expect((e as Error).message).toContain('Allowed values');
      }
    });
  });

  describe('StrictSchemaValidation validation', () => {
    it('should accept boolean true', () => {
      expect(() => validateEndpointConfig({ StrictSchemaValidation: true })).not.toThrow();
    });

    it('should accept boolean false', () => {
      expect(() => validateEndpointConfig({ StrictSchemaValidation: false })).not.toThrow();
    });

    it('should accept string "True"', () => {
      expect(() => validateEndpointConfig({ StrictSchemaValidation: 'True' })).not.toThrow();
    });

    it('should accept string "true"', () => {
      expect(() => validateEndpointConfig({ StrictSchemaValidation: 'true' })).not.toThrow();
    });

    it('should accept string "False"', () => {
      expect(() => validateEndpointConfig({ StrictSchemaValidation: 'False' })).not.toThrow();
    });

    it('should accept string "false"', () => {
      expect(() => validateEndpointConfig({ StrictSchemaValidation: 'false' })).not.toThrow();
    });

    it('should accept string "1"', () => {
      expect(() => validateEndpointConfig({ StrictSchemaValidation: '1' })).not.toThrow();
    });

    it('should accept string "0"', () => {
      expect(() => validateEndpointConfig({ StrictSchemaValidation: '0' })).not.toThrow();
    });

    it('should throw for invalid string "Yes"', () => {
      expect(() => validateEndpointConfig({ StrictSchemaValidation: 'Yes' })).toThrow(/Invalid value/);
    });

    it('should throw for invalid string "No"', () => {
      expect(() => validateEndpointConfig({ StrictSchemaValidation: 'No' })).toThrow(/Invalid value/);
    });

    it('should throw for number value', () => {
      expect(() => validateEndpointConfig({ StrictSchemaValidation: 123 })).toThrow(/Invalid type/);
    });

    it('should throw for object value', () => {
      expect(() => validateEndpointConfig({ StrictSchemaValidation: { enabled: true } })).toThrow(/Invalid type/);
    });

    it('should throw for array value', () => {
      expect(() => validateEndpointConfig({ StrictSchemaValidation: ['true'] })).toThrow(/Invalid type/);
    });

    it('should include flag name in error message', () => {
      try {
        validateEndpointConfig({ StrictSchemaValidation: 'invalid' });
        fail('Expected error');
      } catch (e) {
        expect((e as Error).message).toContain('StrictSchemaValidation');
      }
    });

    it('should include allowed values in error message', () => {
      try {
        validateEndpointConfig({ StrictSchemaValidation: 'invalid' });
        fail('Expected error');
      } catch (e) {
        expect((e as Error).message).toContain('Allowed values');
      }
    });
  });

  describe('All new flags together', () => {
    it('should accept all new flags set to valid values', () => {
      expect(() =>
        validateEndpointConfig({
          SoftDeleteEnabled: 'True',
          StrictSchemaValidation: 'False',
          MultiOpPatchRequestAddMultipleMembersToGroup: true,
          VerbosePatchSupported: false,
          logLevel: 'DEBUG',
        })
      ).not.toThrow();
    });

    it('should reject if SoftDeleteEnabled is invalid even if others are valid', () => {
      expect(() =>
        validateEndpointConfig({
          SoftDeleteEnabled: 'invalid',
          StrictSchemaValidation: 'True',
        })
      ).toThrow(/SoftDeleteEnabled/);
    });

    it('should reject if StrictSchemaValidation is invalid even if others are valid', () => {
      expect(() =>
        validateEndpointConfig({
          SoftDeleteEnabled: 'True',
          StrictSchemaValidation: 'invalid',
        })
      ).toThrow(/StrictSchemaValidation/);
    });

    it('should accept AllowAndCoerceBooleanStrings with other flags', () => {
      expect(() =>
        validateEndpointConfig({
          AllowAndCoerceBooleanStrings: 'True',
          StrictSchemaValidation: 'True',
          SoftDeleteEnabled: 'False',
        })
      ).not.toThrow();
    });

    it('should reject invalid AllowAndCoerceBooleanStrings even if others are valid', () => {
      expect(() =>
        validateEndpointConfig({
          AllowAndCoerceBooleanStrings: 'invalid',
          StrictSchemaValidation: 'True',
        })
      ).toThrow(/AllowAndCoerceBooleanStrings/);
    });
  });

  describe('getConfigBooleanWithDefault', () => {
    it('should return defaultValue for undefined config', () => {
      expect(getConfigBooleanWithDefault(undefined, 'anyKey', true)).toBe(true);
      expect(getConfigBooleanWithDefault(undefined, 'anyKey', false)).toBe(false);
    });

    it('should return defaultValue for missing key', () => {
      const config: EndpointConfig = {};
      expect(getConfigBooleanWithDefault(config, 'missing', true)).toBe(true);
      expect(getConfigBooleanWithDefault(config, 'missing', false)).toBe(false);
    });

    it('should return actual boolean value when present', () => {
      expect(getConfigBooleanWithDefault({ test: true }, 'test', false)).toBe(true);
      expect(getConfigBooleanWithDefault({ test: false }, 'test', true)).toBe(false);
    });

    it('should parse string "True" correctly', () => {
      expect(getConfigBooleanWithDefault({ test: 'True' }, 'test', false)).toBe(true);
      expect(getConfigBooleanWithDefault({ test: 'true' }, 'test', false)).toBe(true);
      expect(getConfigBooleanWithDefault({ test: 'TRUE' }, 'test', false)).toBe(true);
    });

    it('should parse string "False" correctly', () => {
      expect(getConfigBooleanWithDefault({ test: 'False' }, 'test', true)).toBe(false);
      expect(getConfigBooleanWithDefault({ test: 'false' }, 'test', true)).toBe(false);
      expect(getConfigBooleanWithDefault({ test: 'FALSE' }, 'test', true)).toBe(false);
    });

    it('should parse string "1" as true', () => {
      expect(getConfigBooleanWithDefault({ test: '1' }, 'test', false)).toBe(true);
    });

    it('should parse string "0" as false', () => {
      expect(getConfigBooleanWithDefault({ test: '0' }, 'test', true)).toBe(false);
    });

    it('should return defaultValue for non-boolean/non-string value', () => {
      expect(getConfigBooleanWithDefault({ test: 123 }, 'test', true)).toBe(true);
      expect(getConfigBooleanWithDefault({ test: {} }, 'test', false)).toBe(false);
    });

    it('should use default=true for AllowAndCoerceBooleanStrings when not set', () => {
      const config: EndpointConfig = { StrictSchemaValidation: 'True' };
      expect(getConfigBooleanWithDefault(config, ENDPOINT_CONFIG_FLAGS.ALLOW_AND_COERCE_BOOLEAN_STRINGS, true)).toBe(true);
    });

    it('should respect explicit AllowAndCoerceBooleanStrings=False', () => {
      const config: EndpointConfig = { AllowAndCoerceBooleanStrings: 'False' };
      expect(getConfigBooleanWithDefault(config, ENDPOINT_CONFIG_FLAGS.ALLOW_AND_COERCE_BOOLEAN_STRINGS, true)).toBe(false);
    });
  });

  describe('AllowAndCoerceBooleanStrings validation', () => {
    it('should accept boolean true', () => {
      expect(() => validateEndpointConfig({ AllowAndCoerceBooleanStrings: true })).not.toThrow();
    });

    it('should accept boolean false', () => {
      expect(() => validateEndpointConfig({ AllowAndCoerceBooleanStrings: false })).not.toThrow();
    });

    it('should accept string "True"', () => {
      expect(() => validateEndpointConfig({ AllowAndCoerceBooleanStrings: 'True' })).not.toThrow();
    });

    it('should accept string "true"', () => {
      expect(() => validateEndpointConfig({ AllowAndCoerceBooleanStrings: 'true' })).not.toThrow();
    });

    it('should accept string "False"', () => {
      expect(() => validateEndpointConfig({ AllowAndCoerceBooleanStrings: 'False' })).not.toThrow();
    });

    it('should accept string "false"', () => {
      expect(() => validateEndpointConfig({ AllowAndCoerceBooleanStrings: 'false' })).not.toThrow();
    });

    it('should accept string "1"', () => {
      expect(() => validateEndpointConfig({ AllowAndCoerceBooleanStrings: '1' })).not.toThrow();
    });

    it('should accept string "0"', () => {
      expect(() => validateEndpointConfig({ AllowAndCoerceBooleanStrings: '0' })).not.toThrow();
    });

    it('should throw for invalid string "Yes"', () => {
      expect(() => validateEndpointConfig({ AllowAndCoerceBooleanStrings: 'Yes' })).toThrow(/Invalid value/);
    });

    it('should throw for number value', () => {
      expect(() => validateEndpointConfig({ AllowAndCoerceBooleanStrings: 123 })).toThrow(/Invalid type/);
    });

    it('should throw for array value', () => {
      expect(() => validateEndpointConfig({ AllowAndCoerceBooleanStrings: ['true'] })).toThrow(/Invalid type/);
    });

    it('should include flag name in error message', () => {
      try {
        validateEndpointConfig({ AllowAndCoerceBooleanStrings: 'invalid' });
        fail('Expected error');
      } catch (e) {
        expect((e as Error).message).toContain('AllowAndCoerceBooleanStrings');
      }
    });
  });

  describe('RequireIfMatch validation', () => {
    it('should accept boolean true', () => {
      expect(() => validateEndpointConfig({ RequireIfMatch: true })).not.toThrow();
    });

    it('should accept boolean false', () => {
      expect(() => validateEndpointConfig({ RequireIfMatch: false })).not.toThrow();
    });

    it('should accept string "True"', () => {
      expect(() => validateEndpointConfig({ RequireIfMatch: 'True' })).not.toThrow();
    });

    it('should accept string "true"', () => {
      expect(() => validateEndpointConfig({ RequireIfMatch: 'true' })).not.toThrow();
    });

    it('should accept string "False"', () => {
      expect(() => validateEndpointConfig({ RequireIfMatch: 'False' })).not.toThrow();
    });

    it('should accept string "false"', () => {
      expect(() => validateEndpointConfig({ RequireIfMatch: 'false' })).not.toThrow();
    });

    it('should accept string "1"', () => {
      expect(() => validateEndpointConfig({ RequireIfMatch: '1' })).not.toThrow();
    });

    it('should accept string "0"', () => {
      expect(() => validateEndpointConfig({ RequireIfMatch: '0' })).not.toThrow();
    });

    it('should throw for invalid string "Yes"', () => {
      expect(() => validateEndpointConfig({ RequireIfMatch: 'Yes' })).toThrow(/Invalid value/);
    });

    it('should throw for invalid string "enabled"', () => {
      expect(() => validateEndpointConfig({ RequireIfMatch: 'enabled' })).toThrow(/Invalid value/);
    });

    it('should throw for number value', () => {
      expect(() => validateEndpointConfig({ RequireIfMatch: 123 })).toThrow(/Invalid type/);
    });

    it('should throw for object value', () => {
      expect(() => validateEndpointConfig({ RequireIfMatch: { enabled: true } })).toThrow(/Invalid type/);
    });

    it('should throw for array value', () => {
      expect(() => validateEndpointConfig({ RequireIfMatch: ['true'] })).toThrow(/Invalid type/);
    });

    it('should include flag name in error message', () => {
      try {
        validateEndpointConfig({ RequireIfMatch: 'invalid' });
        fail('Expected error');
      } catch (e) {
        expect((e as Error).message).toContain('RequireIfMatch');
      }
    });

    it('should include allowed values in error message', () => {
      try {
        validateEndpointConfig({ RequireIfMatch: 'invalid' });
        fail('Expected error');
      } catch (e) {
        expect((e as Error).message).toContain('Allowed values');
      }
    });
  });

  describe('ReprovisionOnConflictForSoftDeletedResource validation', () => {
    it('should accept boolean true', () => {
      expect(() => validateEndpointConfig({ ReprovisionOnConflictForSoftDeletedResource: true })).not.toThrow();
    });

    it('should accept boolean false', () => {
      expect(() => validateEndpointConfig({ ReprovisionOnConflictForSoftDeletedResource: false })).not.toThrow();
    });

    it('should accept string "True"', () => {
      expect(() => validateEndpointConfig({ ReprovisionOnConflictForSoftDeletedResource: 'True' })).not.toThrow();
    });

    it('should accept string "true"', () => {
      expect(() => validateEndpointConfig({ ReprovisionOnConflictForSoftDeletedResource: 'true' })).not.toThrow();
    });

    it('should accept string "False"', () => {
      expect(() => validateEndpointConfig({ ReprovisionOnConflictForSoftDeletedResource: 'False' })).not.toThrow();
    });

    it('should accept string "false"', () => {
      expect(() => validateEndpointConfig({ ReprovisionOnConflictForSoftDeletedResource: 'false' })).not.toThrow();
    });

    it('should accept string "1"', () => {
      expect(() => validateEndpointConfig({ ReprovisionOnConflictForSoftDeletedResource: '1' })).not.toThrow();
    });

    it('should accept string "0"', () => {
      expect(() => validateEndpointConfig({ ReprovisionOnConflictForSoftDeletedResource: '0' })).not.toThrow();
    });

    it('should throw for invalid string "Yes"', () => {
      expect(() => validateEndpointConfig({ ReprovisionOnConflictForSoftDeletedResource: 'Yes' })).toThrow(/Invalid value/);
    });

    it('should throw for invalid string "enabled"', () => {
      expect(() => validateEndpointConfig({ ReprovisionOnConflictForSoftDeletedResource: 'enabled' })).toThrow(/Invalid value/);
    });

    it('should throw for number value', () => {
      expect(() => validateEndpointConfig({ ReprovisionOnConflictForSoftDeletedResource: 123 })).toThrow(/Invalid type/);
    });

    it('should throw for object value', () => {
      expect(() => validateEndpointConfig({ ReprovisionOnConflictForSoftDeletedResource: {} })).toThrow(/Invalid type/);
    });

    it('should throw for array value', () => {
      expect(() => validateEndpointConfig({ ReprovisionOnConflictForSoftDeletedResource: ['true'] })).toThrow(/Invalid type/);
    });

    it('should include flag name in error message', () => {
      try {
        validateEndpointConfig({ ReprovisionOnConflictForSoftDeletedResource: 'invalid' });
        fail('Expected error');
      } catch (e) {
        expect((e as Error).message).toContain('ReprovisionOnConflictForSoftDeletedResource');
      }
    });

    it('should include allowed values in error message', () => {
      try {
        validateEndpointConfig({ ReprovisionOnConflictForSoftDeletedResource: 'invalid' });
        fail('Expected error');
      } catch (e) {
        expect((e as Error).message).toContain('Allowed values');
      }
    });
  });

  describe('CustomResourceTypesEnabled validation', () => {
    it('should accept boolean true', () => {
      expect(() => validateEndpointConfig({ CustomResourceTypesEnabled: true })).not.toThrow();
    });

    it('should accept boolean false', () => {
      expect(() => validateEndpointConfig({ CustomResourceTypesEnabled: false })).not.toThrow();
    });

    it('should accept string "True"', () => {
      expect(() => validateEndpointConfig({ CustomResourceTypesEnabled: 'True' })).not.toThrow();
    });

    it('should accept string "true"', () => {
      expect(() => validateEndpointConfig({ CustomResourceTypesEnabled: 'true' })).not.toThrow();
    });

    it('should accept string "False"', () => {
      expect(() => validateEndpointConfig({ CustomResourceTypesEnabled: 'False' })).not.toThrow();
    });

    it('should accept string "false"', () => {
      expect(() => validateEndpointConfig({ CustomResourceTypesEnabled: 'false' })).not.toThrow();
    });

    it('should accept string "1"', () => {
      expect(() => validateEndpointConfig({ CustomResourceTypesEnabled: '1' })).not.toThrow();
    });

    it('should accept string "0"', () => {
      expect(() => validateEndpointConfig({ CustomResourceTypesEnabled: '0' })).not.toThrow();
    });

    it('should throw for invalid string "Yes"', () => {
      expect(() => validateEndpointConfig({ CustomResourceTypesEnabled: 'Yes' })).toThrow(/Invalid value/);
    });

    it('should throw for invalid string "on"', () => {
      expect(() => validateEndpointConfig({ CustomResourceTypesEnabled: 'on' })).toThrow(/Invalid value/);
    });

    it('should throw for number value', () => {
      expect(() => validateEndpointConfig({ CustomResourceTypesEnabled: 123 })).toThrow(/Invalid type/);
    });

    it('should throw for object value', () => {
      expect(() => validateEndpointConfig({ CustomResourceTypesEnabled: { enabled: true } })).toThrow(/Invalid type/);
    });

    it('should throw for array value', () => {
      expect(() => validateEndpointConfig({ CustomResourceTypesEnabled: ['true'] })).toThrow(/Invalid type/);
    });

    it('should include flag name in error message', () => {
      try {
        validateEndpointConfig({ CustomResourceTypesEnabled: 'invalid' });
        fail('Expected error');
      } catch (e) {
        expect((e as Error).message).toContain('CustomResourceTypesEnabled');
      }
    });

    it('should include allowed values in error message', () => {
      try {
        validateEndpointConfig({ CustomResourceTypesEnabled: 'invalid' });
        fail('Expected error');
      } catch (e) {
        expect((e as Error).message).toContain('Allowed values');
      }
    });
  });

  describe('BulkOperationsEnabled validation', () => {
    it('should accept boolean true', () => {
      expect(() => validateEndpointConfig({ BulkOperationsEnabled: true })).not.toThrow();
    });

    it('should accept boolean false', () => {
      expect(() => validateEndpointConfig({ BulkOperationsEnabled: false })).not.toThrow();
    });

    it('should accept string "True"', () => {
      expect(() => validateEndpointConfig({ BulkOperationsEnabled: 'True' })).not.toThrow();
    });

    it('should accept string "true"', () => {
      expect(() => validateEndpointConfig({ BulkOperationsEnabled: 'true' })).not.toThrow();
    });

    it('should accept string "False"', () => {
      expect(() => validateEndpointConfig({ BulkOperationsEnabled: 'False' })).not.toThrow();
    });

    it('should accept string "false"', () => {
      expect(() => validateEndpointConfig({ BulkOperationsEnabled: 'false' })).not.toThrow();
    });

    it('should accept string "1"', () => {
      expect(() => validateEndpointConfig({ BulkOperationsEnabled: '1' })).not.toThrow();
    });

    it('should accept string "0"', () => {
      expect(() => validateEndpointConfig({ BulkOperationsEnabled: '0' })).not.toThrow();
    });

    it('should throw for invalid string "Yes"', () => {
      expect(() => validateEndpointConfig({ BulkOperationsEnabled: 'Yes' })).toThrow(/Invalid value/);
    });

    it('should throw for invalid string "on"', () => {
      expect(() => validateEndpointConfig({ BulkOperationsEnabled: 'on' })).toThrow(/Invalid value/);
    });

    it('should throw for number value', () => {
      expect(() => validateEndpointConfig({ BulkOperationsEnabled: 123 })).toThrow(/Invalid type/);
    });

    it('should throw for object value', () => {
      expect(() => validateEndpointConfig({ BulkOperationsEnabled: {} })).toThrow(/Invalid type/);
    });

    it('should throw for array value', () => {
      expect(() => validateEndpointConfig({ BulkOperationsEnabled: ['true'] })).toThrow(/Invalid type/);
    });

    it('should include flag name in error message', () => {
      try {
        validateEndpointConfig({ BulkOperationsEnabled: 'invalid' });
        fail('Expected error');
      } catch (e) {
        expect((e as Error).message).toContain('BulkOperationsEnabled');
      }
    });

    it('should include allowed values in error message', () => {
      try {
        validateEndpointConfig({ BulkOperationsEnabled: 'invalid' });
        fail('Expected error');
      } catch (e) {
        expect((e as Error).message).toContain('Allowed values');
      }
    });
  });

  describe('PerEndpointCredentialsEnabled validation', () => {
    it('should accept boolean true', () => {
      expect(() => validateEndpointConfig({ PerEndpointCredentialsEnabled: true })).not.toThrow();
    });

    it('should accept boolean false', () => {
      expect(() => validateEndpointConfig({ PerEndpointCredentialsEnabled: false })).not.toThrow();
    });

    it('should accept string "True"', () => {
      expect(() => validateEndpointConfig({ PerEndpointCredentialsEnabled: 'True' })).not.toThrow();
    });

    it('should accept string "true"', () => {
      expect(() => validateEndpointConfig({ PerEndpointCredentialsEnabled: 'true' })).not.toThrow();
    });

    it('should accept string "False"', () => {
      expect(() => validateEndpointConfig({ PerEndpointCredentialsEnabled: 'False' })).not.toThrow();
    });

    it('should accept string "false"', () => {
      expect(() => validateEndpointConfig({ PerEndpointCredentialsEnabled: 'false' })).not.toThrow();
    });

    it('should accept string "1"', () => {
      expect(() => validateEndpointConfig({ PerEndpointCredentialsEnabled: '1' })).not.toThrow();
    });

    it('should accept string "0"', () => {
      expect(() => validateEndpointConfig({ PerEndpointCredentialsEnabled: '0' })).not.toThrow();
    });

    it('should throw for invalid string "Yes"', () => {
      expect(() => validateEndpointConfig({ PerEndpointCredentialsEnabled: 'Yes' })).toThrow(/Invalid value/);
    });

    it('should throw for number value', () => {
      expect(() => validateEndpointConfig({ PerEndpointCredentialsEnabled: 123 })).toThrow(/Invalid type/);
    });

    it('should throw for object value', () => {
      expect(() => validateEndpointConfig({ PerEndpointCredentialsEnabled: { key: true } })).toThrow(/Invalid type/);
    });

    it('should throw for array value', () => {
      expect(() => validateEndpointConfig({ PerEndpointCredentialsEnabled: ['true'] })).toThrow(/Invalid type/);
    });

    it('should include flag name in error message', () => {
      try {
        validateEndpointConfig({ PerEndpointCredentialsEnabled: 'invalid' });
        fail('Expected error');
      } catch (e) {
        expect((e as Error).message).toContain('PerEndpointCredentialsEnabled');
      }
    });

    it('should include allowed values in error message', () => {
      try {
        validateEndpointConfig({ PerEndpointCredentialsEnabled: 'invalid' });
        fail('Expected error');
      } catch (e) {
        expect((e as Error).message).toContain('Allowed values');
      }
    });
  });

  describe('IncludeWarningAboutIgnoredReadOnlyAttribute validation', () => {
    it('should accept boolean true', () => {
      expect(() => validateEndpointConfig({ IncludeWarningAboutIgnoredReadOnlyAttribute: true })).not.toThrow();
    });

    it('should accept boolean false', () => {
      expect(() => validateEndpointConfig({ IncludeWarningAboutIgnoredReadOnlyAttribute: false })).not.toThrow();
    });

    it('should accept string "True"', () => {
      expect(() => validateEndpointConfig({ IncludeWarningAboutIgnoredReadOnlyAttribute: 'True' })).not.toThrow();
    });

    it('should accept string "true"', () => {
      expect(() => validateEndpointConfig({ IncludeWarningAboutIgnoredReadOnlyAttribute: 'true' })).not.toThrow();
    });

    it('should accept string "False"', () => {
      expect(() => validateEndpointConfig({ IncludeWarningAboutIgnoredReadOnlyAttribute: 'False' })).not.toThrow();
    });

    it('should accept string "false"', () => {
      expect(() => validateEndpointConfig({ IncludeWarningAboutIgnoredReadOnlyAttribute: 'false' })).not.toThrow();
    });

    it('should accept string "1"', () => {
      expect(() => validateEndpointConfig({ IncludeWarningAboutIgnoredReadOnlyAttribute: '1' })).not.toThrow();
    });

    it('should accept string "0"', () => {
      expect(() => validateEndpointConfig({ IncludeWarningAboutIgnoredReadOnlyAttribute: '0' })).not.toThrow();
    });

    it('should throw for invalid string "Yes"', () => {
      expect(() => validateEndpointConfig({ IncludeWarningAboutIgnoredReadOnlyAttribute: 'Yes' })).toThrow(/Invalid value/);
    });

    it('should throw for number value', () => {
      expect(() => validateEndpointConfig({ IncludeWarningAboutIgnoredReadOnlyAttribute: 42 })).toThrow(/Invalid type/);
    });

    it('should throw for object value', () => {
      expect(() => validateEndpointConfig({ IncludeWarningAboutIgnoredReadOnlyAttribute: {} })).toThrow(/Invalid type/);
    });

    it('should throw for array value', () => {
      expect(() => validateEndpointConfig({ IncludeWarningAboutIgnoredReadOnlyAttribute: ['true'] })).toThrow(/Invalid type/);
    });

    it('should include flag name in error message', () => {
      try {
        validateEndpointConfig({ IncludeWarningAboutIgnoredReadOnlyAttribute: 'invalid' });
        fail('Expected error');
      } catch (e) {
        expect((e as Error).message).toContain('IncludeWarningAboutIgnoredReadOnlyAttribute');
      }
    });

    it('should include allowed values in error message', () => {
      try {
        validateEndpointConfig({ IncludeWarningAboutIgnoredReadOnlyAttribute: 'invalid' });
        fail('Expected error');
      } catch (e) {
        expect((e as Error).message).toContain('Allowed values');
      }
    });
  });

  describe('IgnoreReadOnlyAttributesInPatch validation', () => {
    it('should accept boolean true', () => {
      expect(() => validateEndpointConfig({ IgnoreReadOnlyAttributesInPatch: true })).not.toThrow();
    });

    it('should accept boolean false', () => {
      expect(() => validateEndpointConfig({ IgnoreReadOnlyAttributesInPatch: false })).not.toThrow();
    });

    it('should accept string "True"', () => {
      expect(() => validateEndpointConfig({ IgnoreReadOnlyAttributesInPatch: 'True' })).not.toThrow();
    });

    it('should accept string "true"', () => {
      expect(() => validateEndpointConfig({ IgnoreReadOnlyAttributesInPatch: 'true' })).not.toThrow();
    });

    it('should accept string "False"', () => {
      expect(() => validateEndpointConfig({ IgnoreReadOnlyAttributesInPatch: 'False' })).not.toThrow();
    });

    it('should accept string "false"', () => {
      expect(() => validateEndpointConfig({ IgnoreReadOnlyAttributesInPatch: 'false' })).not.toThrow();
    });

    it('should accept string "1"', () => {
      expect(() => validateEndpointConfig({ IgnoreReadOnlyAttributesInPatch: '1' })).not.toThrow();
    });

    it('should accept string "0"', () => {
      expect(() => validateEndpointConfig({ IgnoreReadOnlyAttributesInPatch: '0' })).not.toThrow();
    });

    it('should throw for invalid string "Yes"', () => {
      expect(() => validateEndpointConfig({ IgnoreReadOnlyAttributesInPatch: 'Yes' })).toThrow(/Invalid value/);
    });

    it('should throw for number value', () => {
      expect(() => validateEndpointConfig({ IgnoreReadOnlyAttributesInPatch: 123 })).toThrow(/Invalid type/);
    });

    it('should throw for object value', () => {
      expect(() => validateEndpointConfig({ IgnoreReadOnlyAttributesInPatch: {} })).toThrow(/Invalid type/);
    });

    it('should throw for array value', () => {
      expect(() => validateEndpointConfig({ IgnoreReadOnlyAttributesInPatch: ['true'] })).toThrow(/Invalid type/);
    });

    it('should include flag name in error message', () => {
      try {
        validateEndpointConfig({ IgnoreReadOnlyAttributesInPatch: 'invalid' });
        fail('Expected error');
      } catch (e) {
        expect((e as Error).message).toContain('IgnoreReadOnlyAttributesInPatch');
      }
    });

    it('should include allowed values in error message', () => {
      try {
        validateEndpointConfig({ IgnoreReadOnlyAttributesInPatch: 'invalid' });
        fail('Expected error');
      } catch (e) {
        expect((e as Error).message).toContain('Allowed values');
      }
    });
  });

  describe('All flags combined validation', () => {
    it('should accept all 14 boolean flags set to valid values', () => {
      expect(() =>
        validateEndpointConfig({
          MultiOpPatchRequestAddMultipleMembersToGroup: 'True',
          MultiOpPatchRequestRemoveMultipleMembersFromGroup: 'True',
          PatchOpAllowRemoveAllMembers: 'False',
          VerbosePatchSupported: true,
          SoftDeleteEnabled: 'True',
          StrictSchemaValidation: 'True',
          RequireIfMatch: 'True',
          AllowAndCoerceBooleanStrings: 'False',
          ReprovisionOnConflictForSoftDeletedResource: 'True',
          CustomResourceTypesEnabled: true,
          BulkOperationsEnabled: '1',
          PerEndpointCredentialsEnabled: 'True',
          IncludeWarningAboutIgnoredReadOnlyAttribute: true,
          IgnoreReadOnlyAttributesInPatch: 'True',
          logLevel: 'DEBUG',
        })
      ).not.toThrow();
    });

    it('should reject when any one flag is invalid among valid flags', () => {
      expect(() =>
        validateEndpointConfig({
          MultiOpPatchRequestAddMultipleMembersToGroup: 'True',
          RequireIfMatch: 'True',
          BulkOperationsEnabled: 'invalid', // <-- invalid
          PerEndpointCredentialsEnabled: 'True',
        })
      ).toThrow(/BulkOperationsEnabled/);
    });

    it('should validate ReprovisionOnConflict independently of SoftDeleteEnabled', () => {
      // Reprovision without SoftDelete is valid config (semantically meaningless, but valid)
      expect(() =>
        validateEndpointConfig({
          ReprovisionOnConflictForSoftDeletedResource: 'True',
          SoftDeleteEnabled: 'False',
        })
      ).not.toThrow();
    });

    it('should validate IgnoreReadOnlyAttributesInPatch independently of StrictSchemaValidation', () => {
      // IgnoreRO without Strict is valid config (has no runtime effect, but valid)
      expect(() =>
        validateEndpointConfig({
          IgnoreReadOnlyAttributesInPatch: 'True',
          StrictSchemaValidation: 'False',
        })
      ).not.toThrow();
    });
  });

  describe('DEFAULT_ENDPOINT_CONFIG', () => {
    it('should have the correct defaults for all 13 boolean flags (settings v7)', () => {
      // New flags (settings v7)
      expect(DEFAULT_ENDPOINT_CONFIG.UserSoftDeleteEnabled).toBe(true);
      expect(DEFAULT_ENDPOINT_CONFIG.UserHardDeleteEnabled).toBe(true);
      expect(DEFAULT_ENDPOINT_CONFIG.GroupHardDeleteEnabled).toBe(true);
      expect(DEFAULT_ENDPOINT_CONFIG.MultiMemberPatchOpForGroupEnabled).toBe(true);
      expect(DEFAULT_ENDPOINT_CONFIG.SchemaDiscoveryEnabled).toBe(true);
      // Changed defaults (settings v7)
      expect(DEFAULT_ENDPOINT_CONFIG.StrictSchemaValidation).toBe(true);
      expect(DEFAULT_ENDPOINT_CONFIG.PatchOpAllowRemoveAllMembers).toBe(false);
      // Unchanged flags
      expect(DEFAULT_ENDPOINT_CONFIG.VerbosePatchSupported).toBe(false);
      expect(DEFAULT_ENDPOINT_CONFIG.RequireIfMatch).toBe(false);
      expect(DEFAULT_ENDPOINT_CONFIG.AllowAndCoerceBooleanStrings).toBe(true);
      expect(DEFAULT_ENDPOINT_CONFIG.PerEndpointCredentialsEnabled).toBe(false);
      expect(DEFAULT_ENDPOINT_CONFIG.IncludeWarningAboutIgnoredReadOnlyAttribute).toBe(false);
      expect(DEFAULT_ENDPOINT_CONFIG.IgnoreReadOnlyAttributesInPatch).toBe(false);
    });

    it('should NOT have removed flags in defaults (settings v7 clean break)', () => {
      expect(DEFAULT_ENDPOINT_CONFIG.SoftDeleteEnabled).toBeUndefined();
      expect(DEFAULT_ENDPOINT_CONFIG.ReprovisionOnConflictForSoftDeletedResource).toBeUndefined();
      expect(DEFAULT_ENDPOINT_CONFIG.MultiOpPatchRequestAddMultipleMembersToGroup).toBeUndefined();
      expect(DEFAULT_ENDPOINT_CONFIG.MultiOpPatchRequestRemoveMultipleMembersFromGroup).toBeUndefined();
    });

    it('should not have a logLevel default (undefined by default)', () => {
      expect(DEFAULT_ENDPOINT_CONFIG.logLevel).toBeUndefined();
    });
  });

  // ─── Settings v7: New flag constants ──────────────────────────────────

  describe('Settings v7 — new flag constants', () => {
    it('should have USER_SOFT_DELETE_ENABLED constant', () => {
      expect(ENDPOINT_CONFIG_FLAGS.USER_SOFT_DELETE_ENABLED).toBe('UserSoftDeleteEnabled');
    });

    it('should have USER_HARD_DELETE_ENABLED constant', () => {
      expect(ENDPOINT_CONFIG_FLAGS.USER_HARD_DELETE_ENABLED).toBe('UserHardDeleteEnabled');
    });

    it('should have GROUP_HARD_DELETE_ENABLED constant', () => {
      expect(ENDPOINT_CONFIG_FLAGS.GROUP_HARD_DELETE_ENABLED).toBe('GroupHardDeleteEnabled');
    });

    it('should have MULTI_MEMBER_PATCH_OP_FOR_GROUP_ENABLED constant', () => {
      expect(ENDPOINT_CONFIG_FLAGS.MULTI_MEMBER_PATCH_OP_FOR_GROUP_ENABLED).toBe('MultiMemberPatchOpForGroupEnabled');
    });

    it('should have SCHEMA_DISCOVERY_ENABLED constant', () => {
      expect(ENDPOINT_CONFIG_FLAGS.SCHEMA_DISCOVERY_ENABLED).toBe('SchemaDiscoveryEnabled');
    });

    it('should validate new boolean flags', () => {
      expect(() => validateEndpointConfig({ UserSoftDeleteEnabled: true })).not.toThrow();
      expect(() => validateEndpointConfig({ UserSoftDeleteEnabled: 'True' })).not.toThrow();
      expect(() => validateEndpointConfig({ UserSoftDeleteEnabled: 'invalid' })).toThrow(/Invalid value/);
      expect(() => validateEndpointConfig({ UserHardDeleteEnabled: true })).not.toThrow();
      expect(() => validateEndpointConfig({ UserHardDeleteEnabled: 123 })).toThrow(/Invalid type/);
      expect(() => validateEndpointConfig({ GroupHardDeleteEnabled: 'False' })).not.toThrow();
      expect(() => validateEndpointConfig({ MultiMemberPatchOpForGroupEnabled: false })).not.toThrow();
      expect(() => validateEndpointConfig({ SchemaDiscoveryEnabled: '1' })).not.toThrow();
    });

    it('should accept all new flags together', () => {
      expect(() => validateEndpointConfig({
        UserSoftDeleteEnabled: 'True',
        UserHardDeleteEnabled: 'True',
        GroupHardDeleteEnabled: 'True',
        MultiMemberPatchOpForGroupEnabled: 'True',
        SchemaDiscoveryEnabled: 'True',
        StrictSchemaValidation: 'True',
        PatchOpAllowRemoveAllMembers: 'False',
        VerbosePatchSupported: 'True',
        AllowAndCoerceBooleanStrings: 'True',
        RequireIfMatch: 'False',
        PerEndpointCredentialsEnabled: 'False',
        IncludeWarningAboutIgnoredReadOnlyAttribute: 'False',
        IgnoreReadOnlyAttributesInPatch: 'False',
        logLevel: 'INFO',
      })).not.toThrow();
    });
  });
});
