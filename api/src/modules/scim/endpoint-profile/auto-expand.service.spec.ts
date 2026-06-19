/**
 * Unit Tests - Auto-Expand Service (Phase 13, Steps 2.1 + 2.2)
 *
 * Tests shorthand → full expansion, "all" shorthand, auto-inject of
 * required attributes, project defaults, and Group active.
 */
import { expandProfile, expandAuthentication, CURRENT_AUTH_SCHEMA_VERSION } from './auto-expand.service';
import {
  SCIM_CORE_USER_SCHEMA,
  SCIM_CORE_GROUP_SCHEMA,
  SCIM_ENTERPRISE_USER_SCHEMA,
} from '../common/scim-constants';
import type { ShorthandProfileInput } from './endpoint-profile.types';

describe('auto-expand.service', () => {
  // ─── Attribute Expansion ──────────────────────────────────────────────

  describe('attribute expansion', () => {
    it('should expand { name: "userName" } to full RFC definition', () => {
      const input: ShorthandProfileInput = {
        schemas: [{
          id: SCIM_CORE_USER_SCHEMA,
          name: 'User',
          attributes: [{ name: 'userName' }],
        }],
        resourceTypes: [{ id: 'User', name: 'User', endpoint: '/Users', description: 'User', schema: SCIM_CORE_USER_SCHEMA, schemaExtensions: [] }],
      };
      const result = expandProfile(input);
      const userSchema = result.schemas.find(s => s.id === SCIM_CORE_USER_SCHEMA)!;
      const userName = userSchema.attributes.find(a => a.name === 'userName')!;
      expect(userName.type).toBe('string');
      expect(userName.multiValued).toBe(false);
      expect(userName.required).toBe(true);
      expect(userName.mutability).toBe('readWrite');
      expect(userName.returned).toBe('default'); // RFC 7643 §8.7.1
      expect(userName.uniqueness).toBe('server');
    });

    it('should expand { name: "emails" } with subAttributes', () => {
      const input: ShorthandProfileInput = {
        schemas: [{
          id: SCIM_CORE_USER_SCHEMA,
          name: 'User',
          attributes: [{ name: 'emails' }],
        }],
        resourceTypes: [{ id: 'User', name: 'User', endpoint: '/Users', description: 'User', schema: SCIM_CORE_USER_SCHEMA, schemaExtensions: [] }],
      };
      const result = expandProfile(input);
      const emails = result.schemas[0].attributes.find(a => a.name === 'emails')!;
      expect(emails.type).toBe('complex');
      expect(emails.multiValued).toBe(true);
      expect(emails.subAttributes).toBeDefined();
      expect(emails.subAttributes!.length).toBeGreaterThan(0);
    });

    it('should preserve explicit overrides over baseline', () => {
      const input: ShorthandProfileInput = {
        schemas: [{
          id: SCIM_CORE_USER_SCHEMA,
          name: 'User',
          attributes: [{ name: 'emails', required: true }],
        }],
        resourceTypes: [{ id: 'User', name: 'User', endpoint: '/Users', description: 'User', schema: SCIM_CORE_USER_SCHEMA, schemaExtensions: [] }],
      };
      const result = expandProfile(input);
      const emails = result.schemas[0].attributes.find(a => a.name === 'emails')!;
      expect(emails.required).toBe(true); // overridden from false
      expect(emails.type).toBe('complex'); // filled from baseline
    });

    it('should pass through custom attributes unmodified', () => {
      const customAttr = {
        name: 'badgeNumber', type: 'string', multiValued: false,
        required: false, mutability: 'readWrite', returned: 'default',
      };
      const input: ShorthandProfileInput = {
        schemas: [{
          id: 'urn:custom:schema',
          name: 'Custom',
          attributes: [customAttr as any],
        }],
        resourceTypes: [{ id: 'Custom', name: 'Custom', endpoint: '/Custom', description: 'Custom', schema: 'urn:custom:schema', schemaExtensions: [] }],
      };
      const result = expandProfile(input);
      const badge = result.schemas[0].attributes.find(a => a.name === 'badgeNumber')!;
      expect(badge.name).toBe('badgeNumber');
      expect(badge.type).toBe('string');
    });
  });

  // ─── "all" Shorthand ──────────────────────────────────────────────────

  describe('"all" shorthand expansion', () => {
    it('should expand User "all" to full attribute list', () => {
      const input: ShorthandProfileInput = {
        schemas: [{ id: SCIM_CORE_USER_SCHEMA, name: 'User', attributes: 'all' }],
        resourceTypes: [{ id: 'User', name: 'User', endpoint: '/Users', description: 'User', schema: SCIM_CORE_USER_SCHEMA, schemaExtensions: [] }],
      };
      const result = expandProfile(input);
      const userSchema = result.schemas.find(s => s.id === SCIM_CORE_USER_SCHEMA)!;
      // Should have all RFC User attributes (id, userName, name, displayName, ... externalId, meta)
      expect(userSchema.attributes.length).toBeGreaterThanOrEqual(15);
      const names = userSchema.attributes.map(a => a.name);
      expect(names).toContain('id');
      expect(names).toContain('userName');
      expect(names).toContain('emails');
      expect(names).toContain('password');
      expect(names).toContain('meta');
    });

    it('should expand Group "all" to full attribute list', () => {
      const input: ShorthandProfileInput = {
        schemas: [{ id: SCIM_CORE_GROUP_SCHEMA, name: 'Group', attributes: 'all' }],
        resourceTypes: [{ id: 'Group', name: 'Group', endpoint: '/Groups', description: 'Group', schema: SCIM_CORE_GROUP_SCHEMA, schemaExtensions: [] }],
      };
      const result = expandProfile(input);
      const group = result.schemas.find(s => s.id === SCIM_CORE_GROUP_SCHEMA)!;
      expect(group.attributes.length).toBeGreaterThanOrEqual(5);
    });

    it('should expand EnterpriseUser "all"', () => {
      const input: ShorthandProfileInput = {
        schemas: [{ id: SCIM_ENTERPRISE_USER_SCHEMA, name: 'EnterpriseUser', attributes: 'all' }],
        resourceTypes: [{ id: 'User', name: 'User', endpoint: '/Users', description: 'User', schema: SCIM_CORE_USER_SCHEMA, schemaExtensions: [] }],
      };
      const result = expandProfile(input);
      const eu = result.schemas.find(s => s.id === SCIM_ENTERPRISE_USER_SCHEMA)!;
      expect(eu.attributes.length).toBe(6); // 6 enterprise attributes
    });

    it('should throw for "all" on unknown schema', () => {
      const input: ShorthandProfileInput = {
        schemas: [{ id: 'urn:unknown:schema', name: 'Unknown', attributes: 'all' }],
        resourceTypes: [],
      };
      expect(() => expandProfile(input)).toThrow('no RFC baseline');
    });
  });

  // ─── Auto-Inject: RFC Required ────────────────────────────────────────

  describe('auto-inject: RFC required', () => {
    it('should auto-inject id on User when missing', () => {
      const input: ShorthandProfileInput = {
        schemas: [{
          id: SCIM_CORE_USER_SCHEMA,
          name: 'User',
          attributes: [{ name: 'userName' }],
        }],
        resourceTypes: [{ id: 'User', name: 'User', endpoint: '/Users', description: 'User', schema: SCIM_CORE_USER_SCHEMA, schemaExtensions: [] }],
      };
      const result = expandProfile(input);
      const names = result.schemas[0].attributes.map(a => a.name);
      expect(names).toContain('id');
      const id = result.schemas[0].attributes.find(a => a.name === 'id')!;
      expect(id.required).toBe(false); // RFC 7643 §3.1: readOnly, server-assigned
      expect(id.mutability).toBe('readOnly');
    });

    it('should auto-inject userName on User when missing', () => {
      const input: ShorthandProfileInput = {
        schemas: [{
          id: SCIM_CORE_USER_SCHEMA,
          name: 'User',
          attributes: [{ name: 'active' }],
        }],
        resourceTypes: [{ id: 'User', name: 'User', endpoint: '/Users', description: 'User', schema: SCIM_CORE_USER_SCHEMA, schemaExtensions: [] }],
      };
      const result = expandProfile(input);
      const names = result.schemas[0].attributes.map(a => a.name);
      expect(names).toContain('userName');
    });

    it('should auto-inject displayName on Group when missing', () => {
      const input: ShorthandProfileInput = {
        schemas: [{
          id: SCIM_CORE_GROUP_SCHEMA,
          name: 'Group',
          attributes: [{ name: 'members' }],
        }],
        resourceTypes: [{ id: 'Group', name: 'Group', endpoint: '/Groups', description: 'Group', schema: SCIM_CORE_GROUP_SCHEMA, schemaExtensions: [] }],
      };
      const result = expandProfile(input);
      const names = result.schemas[0].attributes.map(a => a.name);
      expect(names).toContain('id');
      expect(names).toContain('displayName');
    });

    it('should NOT duplicate id if already present', () => {
      const input: ShorthandProfileInput = {
        schemas: [{
          id: SCIM_CORE_USER_SCHEMA,
          name: 'User',
          attributes: [{ name: 'id' }, { name: 'userName' }],
        }],
        resourceTypes: [{ id: 'User', name: 'User', endpoint: '/Users', description: 'User', schema: SCIM_CORE_USER_SCHEMA, schemaExtensions: [] }],
      };
      const result = expandProfile(input);
      const idCount = result.schemas[0].attributes.filter(a => a.name === 'id').length;
      expect(idCount).toBe(1);
    });
  });

  // ─── Auto-Inject: Project Defaults ────────────────────────────────────

  describe('auto-inject: project defaults', () => {
    it('should auto-inject externalId when missing', () => {
      const input: ShorthandProfileInput = {
        schemas: [{
          id: SCIM_CORE_USER_SCHEMA,
          name: 'User',
          attributes: [{ name: 'userName' }],
        }],
        resourceTypes: [{ id: 'User', name: 'User', endpoint: '/Users', description: 'User', schema: SCIM_CORE_USER_SCHEMA, schemaExtensions: [] }],
      };
      const result = expandProfile(input);
      const names = result.schemas[0].attributes.map(a => a.name);
      expect(names).toContain('externalId');
    });

    it('should auto-inject meta when missing', () => {
      const input: ShorthandProfileInput = {
        schemas: [{
          id: SCIM_CORE_USER_SCHEMA,
          name: 'User',
          attributes: [{ name: 'userName' }],
        }],
        resourceTypes: [{ id: 'User', name: 'User', endpoint: '/Users', description: 'User', schema: SCIM_CORE_USER_SCHEMA, schemaExtensions: [] }],
      };
      const result = expandProfile(input);
      const names = result.schemas[0].attributes.map(a => a.name);
      expect(names).toContain('meta');
    });

    it('should NOT auto-inject active on Group (settings v7: D7 removed)', () => {
      const input: ShorthandProfileInput = {
        schemas: [{
          id: SCIM_CORE_GROUP_SCHEMA,
          name: 'Group',
          attributes: [{ name: 'displayName' }, { name: 'members' }],
        }],
        resourceTypes: [{ id: 'Group', name: 'Group', endpoint: '/Groups', description: 'Group', schema: SCIM_CORE_GROUP_SCHEMA, schemaExtensions: [] }],
      };
      const result = expandProfile(input);
      const names = result.schemas[0].attributes.map(a => a.name);
      expect(names).not.toContain('active');
    });

    it('should NOT auto-inject on unknown/custom schemas', () => {
      const input: ShorthandProfileInput = {
        schemas: [{
          id: 'urn:custom:schema',
          name: 'Custom',
          attributes: [{ name: 'customField', type: 'string', multiValued: false, required: false } as any],
        }],
        resourceTypes: [{ id: 'Custom', name: 'Custom', endpoint: '/Custom', description: 'C', schema: 'urn:custom:schema', schemaExtensions: [] }],
      };
      const result = expandProfile(input);
      expect(result.schemas[0].attributes).toHaveLength(1);
    });
  });

  // ─── SPC Defaults ─────────────────────────────────────────────────────

  describe('SPC defaults', () => {
    it('should fill missing SPC with safe defaults', () => {
      const input: ShorthandProfileInput = {
        schemas: [{ id: SCIM_CORE_USER_SCHEMA, name: 'User', attributes: 'all' }],
        resourceTypes: [{ id: 'User', name: 'User', endpoint: '/Users', description: 'User', schema: SCIM_CORE_USER_SCHEMA, schemaExtensions: [] }],
      };
      const result = expandProfile(input);
      expect(result.serviceProviderConfig.patch.supported).toBe(true);
      expect(result.serviceProviderConfig.bulk.supported).toBe(false);
      expect(result.serviceProviderConfig.filter.supported).toBe(true);
      expect(result.serviceProviderConfig.sort.supported).toBe(false);
      expect(result.serviceProviderConfig.etag.supported).toBe(false);
      expect(result.serviceProviderConfig.changePassword.supported).toBe(false);
    });

    it('should preserve explicit SPC overrides', () => {
      const input: ShorthandProfileInput = {
        schemas: [{ id: SCIM_CORE_USER_SCHEMA, name: 'User', attributes: 'all' }],
        resourceTypes: [{ id: 'User', name: 'User', endpoint: '/Users', description: 'User', schema: SCIM_CORE_USER_SCHEMA, schemaExtensions: [] }],
        serviceProviderConfig: {
          bulk: { supported: true, maxOperations: 500 },
          sort: { supported: true },
        },
      };
      const result = expandProfile(input);
      expect(result.serviceProviderConfig.bulk.supported).toBe(true);
      expect(result.serviceProviderConfig.bulk.maxOperations).toBe(500);
      expect(result.serviceProviderConfig.sort.supported).toBe(true);
    });
  });

  // ─── Settings passthrough ─────────────────────────────────────────────

  describe('settings', () => {
    it('should pass through settings as-is', () => {
      const input: ShorthandProfileInput = {
        schemas: [{ id: SCIM_CORE_USER_SCHEMA, name: 'User', attributes: 'all' }],
        resourceTypes: [{ id: 'User', name: 'User', endpoint: '/Users', description: 'User', schema: SCIM_CORE_USER_SCHEMA, schemaExtensions: [] }],
        settings: { SoftDeleteEnabled: 'True', AllowAndCoerceBooleanStrings: 'True' },
      };
      const result = expandProfile(input);
      expect(result.settings.SoftDeleteEnabled).toBe('True');
      expect(result.settings.AllowAndCoerceBooleanStrings).toBe('True');
    });

    it('should default to empty settings when not provided', () => {
      const input: ShorthandProfileInput = {
        schemas: [{ id: SCIM_CORE_USER_SCHEMA, name: 'User', attributes: 'all' }],
        resourceTypes: [{ id: 'User', name: 'User', endpoint: '/Users', description: 'User', schema: SCIM_CORE_USER_SCHEMA, schemaExtensions: [] }],
      };
      const result = expandProfile(input);
      expect(result.settings).toEqual({});
    });
  });

  // ─── Extension schema with no attributes ──────────────────────────────

  describe('extension schema passthrough', () => {
    it('should create extension schema with empty attributes when undefined', () => {
      const input: ShorthandProfileInput = {
        schemas: [
          { id: SCIM_CORE_USER_SCHEMA, name: 'User', attributes: 'all' },
          { id: 'urn:msfttest:custom:2.0:User', name: 'MsftTest' },
        ],
        resourceTypes: [{ id: 'User', name: 'User', endpoint: '/Users', description: 'User', schema: SCIM_CORE_USER_SCHEMA, schemaExtensions: [] }],
      };
      const result = expandProfile(input);
      const msft = result.schemas.find(s => s.id === 'urn:msfttest:custom:2.0:User')!;
      expect(msft.name).toBe('MsftTest');
      expect(msft.attributes).toEqual([]);
    });
  });

  // ─── A0: authentication model expansion (inert) ─────────────────────
  describe('authentication model (A0)', () => {
    const baseInput: ShorthandProfileInput = {
      schemas: [{ id: SCIM_CORE_USER_SCHEMA, name: 'User', attributes: [{ name: 'userName' }] }],
      resourceTypes: [{ id: 'User', name: 'User', endpoint: '/Users', description: 'User', schema: SCIM_CORE_USER_SCHEMA, schemaExtensions: [] }],
    };

    describe('expandProfile threading', () => {
      it('omits authentication when the input has none (backward compatible)', () => {
        const result = expandProfile(baseInput);
        expect(result.authentication).toBeUndefined();
      });

      it('threads authentication through when provided', () => {
        const result = expandProfile({
          ...baseInput,
          authentication: {
            schemaVersion: 1,
            methods: [{ id: 'm-1', type: 'bearer', displayName: 'Per-Endpoint Bearer' }],
          },
        });
        expect(result.authentication).toBeDefined();
        expect(result.authentication!.methods).toHaveLength(1);
        expect(result.authentication!.methods[0].id).toBe('m-1');
        expect(result.authentication!.methods[0].type).toBe('bearer');
      });

      it('defaults schemaVersion when omitted in the threaded block', () => {
        const result = expandProfile({
          ...baseInput,
          authentication: { methods: [] } as never,
        });
        expect(result.authentication!.schemaVersion).toBe(CURRENT_AUTH_SCHEMA_VERSION);
      });
    });

    describe('expandAuthentication', () => {
      it('defaults schemaVersion to the current version when omitted', () => {
        const out = expandAuthentication({ methods: [] } as never);
        expect(out.schemaVersion).toBe(CURRENT_AUTH_SCHEMA_VERSION);
      });

      it('preserves an explicit schemaVersion', () => {
        const out = expandAuthentication({ schemaVersion: 2, methods: [] });
        expect(out.schemaVersion).toBe(2);
      });

      it('coerces a missing methods array to []', () => {
        const out = expandAuthentication({ schemaVersion: 1 } as never);
        expect(Array.isArray(out.methods)).toBe(true);
        expect(out.methods).toHaveLength(0);
      });

      it('preserves known method fields', () => {
        const out = expandAuthentication({
          schemaVersion: 1,
          methods: [{
            id: 'm-7f3a', type: 'wif-7523', displayName: 'WIF', description: 'desc',
            specUri: 'https://rfc/7523', plane: 'token', tokenEndpointAuthMethod: 'private_key_jwt',
            enabled: true, priority: 10, lifecycleStatus: 'active',
            config: { issuer: 'https://idp', audience: 'app' }, credentialRef: 'cred-1',
          }],
        });
        const m = out.methods[0];
        expect(m.id).toBe('m-7f3a');
        expect(m.type).toBe('wif-7523');
        expect(m.displayName).toBe('WIF');
        expect(m.plane).toBe('token');
        expect(m.tokenEndpointAuthMethod).toBe('private_key_jwt');
        expect(m.enabled).toBe(true);
        expect(m.priority).toBe(10);
        expect(m.lifecycleStatus).toBe('active');
        expect(m.config).toEqual({ issuer: 'https://idp', audience: 'app' });
        expect(m.credentialRef).toBe('cred-1');
      });

      it('strips secret-looking keys from method.config (no-secret invariant)', () => {
        const out = expandAuthentication({
          schemaVersion: 1,
          methods: [{
            id: 'm-1', type: 'oauth-client',
            config: {
              issuer: 'https://idp', jwksUri: 'https://idp/jwks',
              clientSecret: 'SHOULD-NOT-PERSIST', client_secret: 'SHOULD-NOT-PERSIST',
              privateKey: 'SHOULD-NOT-PERSIST', credentialHash: 'SHOULD-NOT-PERSIST',
              password: 'SHOULD-NOT-PERSIST', passphrase: 'SHOULD-NOT-PERSIST',
            },
          }],
        });
        const cfg = out.methods[0].config!;
        expect(cfg.issuer).toBe('https://idp');
        expect(cfg.jwksUri).toBe('https://idp/jwks');
        expect(cfg.clientSecret).toBeUndefined();
        expect(cfg.client_secret).toBeUndefined();
        expect(cfg.privateKey).toBeUndefined();
        expect(cfg.credentialHash).toBeUndefined();
        expect(cfg.password).toBeUndefined();
        expect(cfg.passphrase).toBeUndefined();
      });

      it('drops unexpected secret-looking top-level method keys', () => {
        const out = expandAuthentication({
          schemaVersion: 1,
          methods: [{ id: 'm-1', type: 'bearer', clientSecret: 'LEAK' } as never],
        });
        expect((out.methods[0] as unknown as Record<string, unknown>).clientSecret).toBeUndefined();
      });

      it('preserves defaultMethodId and policy when present', () => {
        const out = expandAuthentication({
          schemaVersion: 1, methods: [], defaultMethodId: 'm-1', policy: { roleEnforcement: 'off' },
        });
        expect(out.defaultMethodId).toBe('m-1');
        expect(out.policy).toEqual({ roleEnforcement: 'off' });
      });
    });
  });

  // ─── Security: prototype-pollution guard (CWE-1321) ─────────────────────
  describe('prototype-pollution guard', () => {
    it('drops a __proto__ key from method.config (no object pollution)', () => {
      // JSON.parse is the one path that makes "__proto__" a real own property.
      const malicious = JSON.parse('{"__proto__": {"polluted": true}, "issuer": "https://idp"}');
      const out = expandAuthentication({
        schemaVersion: 1,
        methods: [{ id: 'm-1', type: 'bearer', config: malicious }],
      });
      const cfg = out.methods[0].config!;
      expect(Object.prototype.hasOwnProperty.call(cfg, '__proto__')).toBe(false);
      expect(cfg.polluted).toBeUndefined();
      expect(cfg.issuer).toBe('https://idp');
      // Object's own prototype must be untouched.
      expect(Object.getPrototypeOf(cfg)).toBe(Object.prototype);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it('drops a __proto__ key during shorthand attribute expansion', () => {
      const malicious = JSON.parse('{"name": "userName", "__proto__": {"polluted": true}}');
      const input: ShorthandProfileInput = {
        schemas: [{ id: SCIM_CORE_USER_SCHEMA, name: 'User', attributes: [malicious] }],
        resourceTypes: [{ id: 'User', name: 'User', endpoint: '/Users', description: 'User', schema: SCIM_CORE_USER_SCHEMA, schemaExtensions: [] }],
      };
      const result = expandProfile(input);
      const userSchema = result.schemas.find(s => s.id === SCIM_CORE_USER_SCHEMA)!;
      const attr = userSchema.attributes.find(a => a.name === 'userName')!;
      expect(Object.prototype.hasOwnProperty.call(attr, '__proto__')).toBe(false);
      expect((attr as unknown as Record<string, unknown>).polluted).toBeUndefined();
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });
  });
});
