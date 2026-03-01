import { HttpException } from '@nestjs/common';
import { SchemasController } from './schemas.controller';
import { ScimDiscoveryService } from '../discovery/scim-discovery.service';
import { ScimSchemaRegistry } from '../discovery/scim-schema-registry';

describe('SchemasController', () => {
  let controller: SchemasController;

  beforeEach(() => {
    const registry = new ScimSchemaRegistry();
    const discoveryService = new ScimDiscoveryService(registry);
    controller = new SchemasController(discoveryService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getSchemas', () => {
    it('should return ListResponse schema', () => {
      const result = controller.getSchemas();
      expect(result.schemas).toEqual([
        'urn:ietf:params:scim:api:messages:2.0:ListResponse',
      ]);
    });

    it('should return 7 schema definitions (User, EnterpriseUser, Group + 4 msfttest)', () => {
      const result = controller.getSchemas();
      expect(result.totalResults).toBe(7);
      expect(result.Resources).toHaveLength(7);
    });

    it('should include User schema with correct id', () => {
      const result = controller.getSchemas();
      const userSchema = result.Resources.find(
        (r: any) => r.id === 'urn:ietf:params:scim:schemas:core:2.0:User',
      );
      expect(userSchema).toBeDefined();
      expect(userSchema!.name).toBe('User');
    });

    it('should include Enterprise User Extension schema', () => {
      const result = controller.getSchemas();
      const enterpriseSchema = result.Resources.find(
        (r: any) =>
          r.id ===
          'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
      );
      expect(enterpriseSchema).toBeDefined();
      expect(enterpriseSchema!.name).toBe('EnterpriseUser');
    });

    it('should include Group schema with correct id', () => {
      const result = controller.getSchemas();
      const groupSchema = result.Resources.find(
        (r: any) => r.id === 'urn:ietf:params:scim:schemas:core:2.0:Group',
      );
      expect(groupSchema).toBeDefined();
      expect(groupSchema!.name).toBe('Group');
    });

    it('should define userName attribute in User schema', () => {
      const result = controller.getSchemas();
      const userSchema = result.Resources.find(
        (r: any) => r.id === 'urn:ietf:params:scim:schemas:core:2.0:User',
      )!;
      const userName = userSchema.attributes.find((a: any) => a.name === 'userName') as any;
      expect(userName).toBeDefined();
      expect(userName.type).toBe('string');
      expect(userName.required).toBe(true);
      expect(userName.uniqueness).toBe('server');
    });

    it('should define displayName attribute in User schema', () => {
      const result = controller.getSchemas();
      const userSchema = result.Resources.find(
        (r: any) => r.id === 'urn:ietf:params:scim:schemas:core:2.0:User',
      )!;
      const displayName = userSchema.attributes.find((a: any) => a.name === 'displayName');
      expect(displayName).toBeDefined();
      expect(displayName!.type).toBe('string');
      expect(displayName!.required).toBe(false);
    });

    it('should define active attribute in User schema', () => {
      const result = controller.getSchemas();
      const userSchema = result.Resources.find(
        (r: any) => r.id === 'urn:ietf:params:scim:schemas:core:2.0:User',
      )!;
      const active = userSchema.attributes.find((a: any) => a.name === 'active');
      expect(active).toBeDefined();
      expect(active!.type).toBe('boolean');
    });

    it('should define emails as multi-valued complex attribute', () => {
      const result = controller.getSchemas();
      const userSchema = result.Resources.find(
        (r: any) => r.id === 'urn:ietf:params:scim:schemas:core:2.0:User',
      )! as any;
      const emails = userSchema.attributes.find((a: any) => a.name === 'emails');
      expect(emails).toBeDefined();
      expect(emails!.type).toBe('complex');
      expect(emails!.multiValued).toBe(true);
      expect(emails!.subAttributes).toBeDefined();
      expect(emails!.subAttributes!.length).toBeGreaterThanOrEqual(2);
    });

    it('should define displayName attribute in Group schema', () => {
      const result = controller.getSchemas();
      const groupSchema = result.Resources.find(
        (r: any) => r.id === 'urn:ietf:params:scim:schemas:core:2.0:Group',
      )!;
      const displayName = groupSchema.attributes.find((a: any) => a.name === 'displayName');
      expect(displayName).toBeDefined();
      expect(displayName!.type).toBe('string');
    });

    it('should have correct pagination metadata', () => {
      const result = controller.getSchemas();
      expect(result.startIndex).toBe(1);
      expect(result.itemsPerPage).toBe(7);
    });

    // ─── D4: schemas[] on Schema resources (RFC 7644 §4) ──────────────

    it('should include schemas[] array on each schema definition (D4)', () => {
      const result = controller.getSchemas();
      for (const schema of result.Resources) {
        expect((schema as any).schemas).toBeDefined();
        expect((schema as any).schemas).toEqual([
          'urn:ietf:params:scim:schemas:core:2.0:Schema',
        ]);
      }
    });
  });

  // ─── getSchemaByUri (D2: Individual Schema lookup) ─────────────────────

  describe('getSchemaByUri', () => {
    it('should return a single User schema by URN', () => {
      const result = controller.getSchemaByUri(
        'urn:ietf:params:scim:schemas:core:2.0:User',
      );
      expect(result).toBeDefined();
      expect(result.id).toBe('urn:ietf:params:scim:schemas:core:2.0:User');
      expect(result.name).toBe('User');
    });

    it('should return Enterprise User schema by URN', () => {
      const result = controller.getSchemaByUri(
        'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
      );
      expect(result).toBeDefined();
      expect(result.name).toBe('EnterpriseUser');
    });

    it('should return Group schema by URN', () => {
      const result = controller.getSchemaByUri(
        'urn:ietf:params:scim:schemas:core:2.0:Group',
      );
      expect(result).toBeDefined();
      expect(result.name).toBe('Group');
    });

    it('should throw 404 SCIM error for unknown schema URN', () => {
      expect(() =>
        controller.getSchemaByUri('urn:unknown:schema'),
      ).toThrow(HttpException);

      try {
        controller.getSchemaByUri('urn:unknown:schema');
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(404);
        const body = (e as HttpException).getResponse() as any;
        expect(body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
        expect(body.detail).toContain('urn:unknown:schema');
        expect(body.status).toBe('404');
      }
    });

    it('should include schemas[] on individually retrieved schema (D4)', () => {
      const result = controller.getSchemaByUri(
        'urn:ietf:params:scim:schemas:core:2.0:User',
      );
      expect((result as any).schemas).toEqual([
        'urn:ietf:params:scim:schemas:core:2.0:Schema',
      ]);
    });
  });
});
