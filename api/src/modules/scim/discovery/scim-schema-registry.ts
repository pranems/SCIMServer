import { Injectable, BadRequestException, Inject, Logger, type OnModuleInit, Optional } from '@nestjs/common';
import {
  SCIM_CORE_USER_SCHEMA,
  SCIM_CORE_GROUP_SCHEMA,
  MSFTTEST_CUSTOM_USER_SCHEMA,
  MSFTTEST_CUSTOM_GROUP_SCHEMA,
  MSFTTEST_IETF_USER_SCHEMA,
  MSFTTEST_IETF_GROUP_SCHEMA,
  SCIM_SCHEMA_SCHEMA,
  SCIM_RESOURCE_TYPE_SCHEMA,
} from '../common/scim-constants';
import {
  SCIM_USER_SCHEMA_DEFINITION,
  SCIM_ENTERPRISE_USER_SCHEMA_DEFINITION,
  SCIM_GROUP_SCHEMA_DEFINITION,
  SCIM_USER_RESOURCE_TYPE,
  SCIM_GROUP_RESOURCE_TYPE,
  SCIM_SERVICE_PROVIDER_CONFIG,
} from './scim-schemas.constants';
import type { EndpointConfig } from '../../endpoint/endpoint-config.interface';
import { ENDPOINT_CONFIG_FLAGS, getConfigBooleanWithDefault } from '../../endpoint/endpoint-config.interface';
import { ENDPOINT_SCHEMA_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import { ENDPOINT_RESOURCE_TYPE_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import type { IEndpointSchemaRepository } from '../../../domain/repositories/endpoint-schema.repository.interface';
import type { IEndpointResourceTypeRepository } from '../../../domain/repositories/endpoint-resource-type.repository.interface';

// ─── Types ──────────────────────────────────────────────────────────────────

/** RFC 7643 §7 Schema attribute definition */
export interface ScimSchemaAttribute {
  name: string;
  type: string;
  multiValued: boolean;
  required: boolean;
  description?: string;
  mutability?: string;
  returned?: string;
  caseExact?: boolean;
  uniqueness?: string;
  referenceTypes?: readonly string[];
  subAttributes?: readonly ScimSchemaAttribute[];
}

/** RFC 7643 §7 Schema definition */
export interface ScimSchemaDefinition {
  schemas?: readonly string[];
  id: string;
  name: string;
  description: string;
  attributes: readonly ScimSchemaAttribute[];
  meta?: {
    resourceType: string;
    location: string;
  };
}

/** RFC 7643 §6 Schema extension on a ResourceType */
export interface SchemaExtensionRef {
  schema: string;
  required: boolean;
}

/** RFC 7643 §6 ResourceType definition */
export interface ScimResourceType {
  schemas?: readonly string[];
  id: string;
  name: string;
  endpoint: string;
  description: string;
  schema: string;
  schemaExtensions: SchemaExtensionRef[];
  meta?: {
    resourceType: string;
    location: string;
  };
}

// ─── Registry ───────────────────────────────────────────────────────────────

/** Per-endpoint extension overlay */
interface EndpointOverlay {
  /** Extension schemas registered for this specific endpoint */
  schemas: Map<string, ScimSchemaDefinition>;
  /** Extension URNs attached to each resource type for this endpoint */
  extensionsByResourceType: Map<string, Set<string>>;
  /** Custom resource types registered for this specific endpoint (Phase 8b) */
  resourceTypes: Map<string, ScimResourceType>;
}

/**
 * ScimSchemaRegistry — Per-Endpoint Runtime Schema Extension Registry
 *
 * Manages SCIM schema definitions and resource type declarations with
 * two layers:
 *
 * 1. **Global layer** — Pre-loaded with RFC 7643 built-in schemas
 *    (User, EnterpriseUser, Group). Shared by all endpoints. Extensions
 *    registered globally (without endpointId) apply to every endpoint.
 *
 * 2. **Per-endpoint layer** — Each endpoint can register additional
 *    extension schemas via `registerExtension(schema, rtId, required, endpointId)`.
 *    These appear only in that endpoint's discovery responses.
 *
 * Query methods accept an optional `endpointId`. When provided, results
 * merge global + endpoint-specific data. When omitted, only global data
 * is returned (backward compatible).
 *
 * @example
 *   // Register a global extension (all endpoints see it)
 *   registry.registerExtension(badgeSchema, 'User');
 *
 *   // Register an endpoint-specific extension
 *   registry.registerExtension(customSchema, 'User', false, 'endpoint-1');
 *
 *   // Query for endpoint-1 — sees global + endpoint-1 extensions
 *   registry.getAllSchemas('endpoint-1');
 *
 *   // Query for endpoint-2 — sees only global extensions
 *   registry.getAllSchemas('endpoint-2');
 */
@Injectable()
export class ScimSchemaRegistry implements OnModuleInit {
  private readonly logger = new Logger(ScimSchemaRegistry.name);

  // ─── Global layer ─────────────────────────────────────────────────────

  /** All global schema definitions keyed by schema URN */
  private readonly schemas = new Map<string, ScimSchemaDefinition>();

  /** All registered resource types keyed by resource type id */
  private readonly resourceTypes = new Map<string, ScimResourceType>();

  /** Global extension URNs keyed by resource type id */
  private readonly extensionsByResourceType = new Map<string, Set<string>>();

  /** Core (non-extension) schema URNs — these cannot be unregistered */
  private readonly coreSchemaUrns = new Set<string>();

  // ─── Per-endpoint layer ───────────────────────────────────────────────

  /** Per-endpoint extension overlays */
  private readonly endpointOverlays = new Map<string, EndpointOverlay>();

  constructor(
    @Optional()
    @Inject(ENDPOINT_SCHEMA_REPOSITORY)
    private readonly schemaRepo?: IEndpointSchemaRepository,
    @Optional()
    @Inject(ENDPOINT_RESOURCE_TYPE_REPOSITORY)
    private readonly resourceTypeRepo?: IEndpointResourceTypeRepository,
  ) {
    this.loadBuiltInSchemas();
  }

  /**
   * OnModuleInit — Load persisted per-endpoint schema extensions from the
   * database and hydrate the in-memory registry. This ensures that all
   * previously registered extensions are available immediately on startup.
   */
  async onModuleInit(): Promise<void> {
    // ─── Hydrate persisted schema extensions ──────────────────────────

    if (this.schemaRepo) {
      try {
        const rows = await this.schemaRepo.findAll();
        let count = 0;

        for (const row of rows) {
          const definition: ScimSchemaDefinition = {
            schemas: [SCIM_SCHEMA_SCHEMA],
            id: row.schemaUrn,
            name: row.name,
            description: row.description ?? '',
            attributes: Array.isArray(row.attributes)
              ? (row.attributes as ScimSchemaAttribute[])
              : [],
            meta: {
              resourceType: 'Schema',
              location: `/Schemas/${row.schemaUrn}`,
            },
          };

          this.registerExtension(
            definition,
            row.resourceTypeId ?? undefined,
            row.required,
            row.endpointId,
          );
          count++;
        }

        if (count > 0) {
          this.logger.log(`Hydrated ${count} persisted schema extension(s) from database.`);
        }
      } catch (error) {
        this.logger.error('Failed to hydrate schema extensions from database', error);
      }
    } else {
      this.logger.debug('No EndpointSchema repository injected — skipping schema DB hydration.');
    }

    // ─── Hydrate persisted custom resource types (Phase 8b) ───────────

    if (this.resourceTypeRepo) {
      try {
        const rows = await this.resourceTypeRepo.findAll();
        let count = 0;

        for (const row of rows) {
          const extensions = Array.isArray(row.schemaExtensions)
            ? row.schemaExtensions.map((e) => ({
                schema: e.schema,
                required: e.required,
              }))
            : [];

          this.registerResourceType(
            {
              id: row.name,
              name: row.name,
              endpoint: row.endpoint,
              description: row.description ?? `Custom resource type: ${row.name}`,
              schema: row.schemaUri,
              schemaExtensions: extensions,
            },
            row.endpointId,
          );
          count++;
        }

        if (count > 0) {
          this.logger.log(`Hydrated ${count} persisted custom resource type(s) from database.`);
        }
      } catch (error) {
        this.logger.error('Failed to hydrate custom resource types from database', error);
      }
    } else {
      this.logger.debug('No EndpointResourceType repository injected — skipping resource type DB hydration.');
    }
  }

  // ─── Built-in initialization ────────────────────────────────────────────

  private loadBuiltInSchemas(): void {
    // Core schemas
    this.schemas.set(SCIM_USER_SCHEMA_DEFINITION.id, SCIM_USER_SCHEMA_DEFINITION as ScimSchemaDefinition);
    this.schemas.set(SCIM_ENTERPRISE_USER_SCHEMA_DEFINITION.id, SCIM_ENTERPRISE_USER_SCHEMA_DEFINITION as ScimSchemaDefinition);
    this.schemas.set(SCIM_GROUP_SCHEMA_DEFINITION.id, SCIM_GROUP_SCHEMA_DEFINITION as ScimSchemaDefinition);

    this.coreSchemaUrns.add(SCIM_CORE_USER_SCHEMA);
    this.coreSchemaUrns.add(SCIM_CORE_GROUP_SCHEMA);

    // Resource types (deep copy to allow mutation of schemaExtensions)
    const userRT: ScimResourceType = {
      ...SCIM_USER_RESOURCE_TYPE,
      schemaExtensions: [...SCIM_USER_RESOURCE_TYPE.schemaExtensions],
    };
    const groupRT: ScimResourceType = {
      ...SCIM_GROUP_RESOURCE_TYPE,
      schemaExtensions: [...SCIM_GROUP_RESOURCE_TYPE.schemaExtensions],
    };
    this.resourceTypes.set(userRT.id, userRT);
    this.resourceTypes.set(groupRT.id, groupRT);

    // Track built-in extension URNs
    for (const ext of userRT.schemaExtensions) {
      this.getOrCreateExtensionSet('User').add(ext.schema);
    }

    // ─── Microsoft Test (msfttest) extension schemas ──────────────────────
    // These are used by the SCIM Validator and Microsoft Entra test harness.
    // Registered globally so every endpoint can accept them by default.
    const msfttestSchemas: { urn: string; name: string; resourceType: 'User' | 'Group' }[] = [
      { urn: MSFTTEST_CUSTOM_USER_SCHEMA,  name: 'MsftTest Custom User Extension',  resourceType: 'User' },
      { urn: MSFTTEST_CUSTOM_GROUP_SCHEMA, name: 'MsftTest Custom Group Extension', resourceType: 'Group' },
      { urn: MSFTTEST_IETF_USER_SCHEMA,    name: 'MsftTest IETF User Extension',    resourceType: 'User' },
      { urn: MSFTTEST_IETF_GROUP_SCHEMA,   name: 'MsftTest IETF Group Extension',   resourceType: 'Group' },
    ];

    for (const ext of msfttestSchemas) {
      const definition: ScimSchemaDefinition = {
        schemas: [SCIM_SCHEMA_SCHEMA],
        id: ext.urn,
        name: ext.name,
        description: `Built-in extension schema for ${ext.name}`,
        attributes: [
          {
            name: 'name',
            type: 'string',
            multiValued: false,
            required: false,
            description: 'Extension attribute (name)',
            mutability: 'readWrite',
            returned: 'default',
          },
        ],
        meta: {
          resourceType: 'Schema',
          location: `/Schemas/${ext.urn}`,
        },
      };

      this.schemas.set(definition.id, definition);
      this.getOrCreateExtensionSet(ext.resourceType).add(ext.urn);

      // Add to the resource type's schemaExtensions so /ResourceTypes reports them
      const rt = this.resourceTypes.get(ext.resourceType);
      if (rt) {
        rt.schemaExtensions.push({ schema: ext.urn, required: false });
      }
    }
  }

  // ─── Registration ──────────────────────────────────────────────────────

  /**
   * Register a custom extension schema, optionally scoped to an endpoint.
   *
   * @param schema         RFC 7643 §7 schema definition with `id`, `name`, `attributes`
   * @param resourceTypeId Resource type to attach to (e.g., 'User', 'Group'). Optional.
   * @param required       Whether the extension is required on the resource type (default: false)
   * @param endpointId     If provided, the extension is scoped to this endpoint only.
   *                       If omitted, the extension is registered globally (all endpoints see it).
   *
   * @throws BadRequestException if schema id is missing, already a core schema,
   *         or the resource type does not exist
   *
   * @example
   *   // Global extension — all endpoints see it
   *   registry.registerExtension(badgeSchema, 'User');
   *
   *   // Endpoint-specific extension — only endpoint-1 sees it
   *   registry.registerExtension(customSchema, 'User', false, 'endpoint-1');
   */
  registerExtension(
    schema: ScimSchemaDefinition,
    resourceTypeId?: string,
    required = false,
    endpointId?: string,
  ): void {
    // Validate
    if (!schema.id) {
      throw new BadRequestException('Schema definition must have an "id" (schema URN).');
    }
    if (this.coreSchemaUrns.has(schema.id)) {
      throw new BadRequestException(
        `Cannot overwrite core schema "${schema.id}". Only extension schemas can be registered.`,
      );
    }
    if (resourceTypeId && !this.resourceTypes.has(resourceTypeId)) {
      // For per-endpoint registrations, also check the endpoint overlay resource types
      if (endpointId) {
        const overlay = this.endpointOverlays.get(endpointId);
        if (!overlay?.resourceTypes.has(resourceTypeId)) {
          throw new BadRequestException(
            `Resource type "${resourceTypeId}" not found. Available: ${[...this.resourceTypes.keys(), ...(overlay?.resourceTypes.keys() ?? [])].join(', ')}`,
          );
        }
      } else {
        throw new BadRequestException(
          `Resource type "${resourceTypeId}" not found. Available: ${[...this.resourceTypes.keys()].join(', ')}`,
        );
      }
    }

    // Ensure meta and schemas are populated
    const definition: ScimSchemaDefinition = {
      ...schema,
      schemas: schema.schemas ?? [SCIM_SCHEMA_SCHEMA],
      meta: schema.meta ?? {
        resourceType: 'Schema',
        location: `/Schemas/${schema.id}`,
      },
    };

    if (endpointId) {
      // ─── Per-endpoint registration ────────────────────────────────
      const overlay = this.getOrCreateOverlay(endpointId);
      overlay.schemas.set(definition.id, definition);

      if (resourceTypeId) {
        const extSet = this.getOrCreateOverlayExtensionSet(overlay, resourceTypeId);
        extSet.add(definition.id);
      }
    } else {
      // ─── Global registration ──────────────────────────────────────
      this.schemas.set(definition.id, definition);

      if (resourceTypeId) {
        const rt = this.resourceTypes.get(resourceTypeId)!;
        const alreadyAttached = rt.schemaExtensions.some((e) => e.schema === definition.id);
        if (!alreadyAttached) {
          rt.schemaExtensions.push({ schema: definition.id, required });
          this.getOrCreateExtensionSet(resourceTypeId).add(definition.id);
        }
      }
    }
  }

  /**
   * Unregister a custom extension schema.
   * Core schemas (User, Group) cannot be unregistered.
   *
   * @param schemaUrn  The schema URN to remove
   * @param endpointId If provided, removes only the endpoint-specific registration.
   *                   If omitted, removes from the global layer.
   * @returns true if the schema was removed, false if it was not found
   */
  unregisterExtension(schemaUrn: string, endpointId?: string): boolean {
    if (this.coreSchemaUrns.has(schemaUrn)) {
      throw new BadRequestException(`Cannot unregister core schema "${schemaUrn}".`);
    }

    if (endpointId) {
      // ─── Per-endpoint removal ─────────────────────────────────────
      const overlay = this.endpointOverlays.get(endpointId);
      if (!overlay) return false;

      const existed = overlay.schemas.delete(schemaUrn);
      for (const extSet of overlay.extensionsByResourceType.values()) {
        extSet.delete(schemaUrn);
      }
      return existed;
    }

    // ─── Global removal ───────────────────────────────────────────────
    const existed = this.schemas.delete(schemaUrn);

    // Remove from all resource types
    for (const [rtId, rt] of this.resourceTypes) {
      rt.schemaExtensions = rt.schemaExtensions.filter((e) => e.schema !== schemaUrn);
      this.extensionsByResourceType.get(rtId)?.delete(schemaUrn);
    }

    return existed;
  }

  // ─── Custom Resource Type Registration (Phase 8b) ─────────────────────

  /**
   * Register a custom resource type, scoped to a specific endpoint.
   *
   * Custom resource types are always per-endpoint — they are NOT registered globally.
   * This method adds the resource type to the endpoint overlay so that discovery
   * responses include it and the generic controller can serve CRUD for it.
   *
   * @param resourceType RFC 7643 §6 ResourceType definition
   * @param endpointId   The endpoint to register for (required for custom types)
   *
   * @throws BadRequestException if the resource type id conflicts with a built-in type
   *
   * @example
   *   registry.registerResourceType({
   *     id: 'Device',
   *     name: 'Device',
   *     endpoint: '/Devices',
   *     description: 'IoT Device resource',
   *     schema: 'urn:ietf:params:scim:schemas:core:2.0:Device',
   *     schemaExtensions: [],
   *   }, 'endpoint-1');
   */
  registerResourceType(resourceType: ScimResourceType, endpointId: string): void {
    if (!resourceType.id || !resourceType.name) {
      throw new BadRequestException('ResourceType must have an "id" and "name".');
    }
    if (!endpointId) {
      throw new BadRequestException('Custom resource types must be scoped to an endpoint.');
    }

    // Ensure meta and schemas are populated
    const rt: ScimResourceType = {
      ...resourceType,
      schemas: resourceType.schemas ?? [SCIM_RESOURCE_TYPE_SCHEMA],
      schemaExtensions: [...resourceType.schemaExtensions],
      meta: resourceType.meta ?? {
        resourceType: 'ResourceType',
        location: `/ResourceTypes/${resourceType.id}`,
      },
    };

    const overlay = this.getOrCreateOverlay(endpointId);
    overlay.resourceTypes.set(rt.id, rt);
  }

  /**
   * Unregister a custom resource type from a specific endpoint.
   *
   * @param resourceTypeId The resource type id/name to remove (e.g., "Device")
   * @param endpointId     The endpoint to remove from
   * @returns true if the resource type was removed, false if not found
   */
  unregisterResourceType(resourceTypeId: string, endpointId: string): boolean {
    const overlay = this.endpointOverlays.get(endpointId);
    if (!overlay) return false;

    const existed = overlay.resourceTypes.delete(resourceTypeId);
    // Also remove any extensions keyed to this resource type
    overlay.extensionsByResourceType.delete(resourceTypeId);
    return existed;
  }

  /**
   * Check if a resource type is registered (globally or per-endpoint).
   */
  hasResourceType(resourceTypeId: string, endpointId?: string): boolean {
    if (this.resourceTypes.has(resourceTypeId)) return true;
    if (endpointId) {
      const overlay = this.endpointOverlays.get(endpointId);
      if (overlay?.resourceTypes.has(resourceTypeId)) return true;
    }
    return false;
  }

  /**
   * Get only the custom (per-endpoint) resource types for an endpoint.
   * Does NOT include built-in User/Group types.
   * Extensions from overlay.extensionsByResourceType are merged.
   */
  getCustomResourceTypes(endpointId: string): ScimResourceType[] {
    const overlay = this.endpointOverlays.get(endpointId);
    if (!overlay) return [];
    return [...overlay.resourceTypes.values()].map((rt) => {
      const epExtensions = overlay.extensionsByResourceType.get(rt.id);
      if (!epExtensions || epExtensions.size === 0) return rt;

      const mergedExtensions = [...rt.schemaExtensions];
      for (const urn of epExtensions) {
        if (!mergedExtensions.some((e) => e.schema === urn)) {
          mergedExtensions.push({ schema: urn, required: false });
        }
      }
      return { ...rt, schemaExtensions: mergedExtensions };
    });
  }

  /**
   * Find a custom resource type by its SCIM endpoint path.
   * Used by the generic controller to resolve /:resourceType path to a registered type.
   *
   * @param endpointPath The SCIM endpoint path (e.g., "/Devices")
   * @param endpointId   The SCIM endpoint id
   * @returns The matching resource type or undefined
   */
  findResourceTypeByEndpointPath(endpointPath: string, endpointId: string): ScimResourceType | undefined {
    const overlay = this.endpointOverlays.get(endpointId);
    if (!overlay) return undefined;

    for (const rt of overlay.resourceTypes.values()) {
      if (rt.endpoint === endpointPath) {
        // Merge endpoint-specific extension URNs into the custom resource type
        const epExtensions = overlay.extensionsByResourceType.get(rt.id);
        if (!epExtensions || epExtensions.size === 0) return rt;

        const mergedExtensions = [...rt.schemaExtensions];
        for (const urn of epExtensions) {
          if (!mergedExtensions.some((e) => e.schema === urn)) {
            mergedExtensions.push({ schema: urn, required: false });
          }
        }
        return { ...rt, schemaExtensions: mergedExtensions };
      }
    }
    return undefined;
  }

  // ─── Queries ───────────────────────────────────────────────────────────

  /**
   * All schema definitions visible to an endpoint (global + endpoint-specific).
   * If endpointId is omitted, returns only global schemas.
   */
  getAllSchemas(endpointId?: string): ScimSchemaDefinition[] {
    const result = [...this.schemas.values()];
    if (endpointId) {
      const overlay = this.endpointOverlays.get(endpointId);
      if (overlay) {
        for (const [urn, schema] of overlay.schemas) {
          // Endpoint-specific overrides global if same URN
          if (!this.schemas.has(urn)) {
            result.push(schema);
          }
        }
      }
    }
    return result;
  }

  /** Get a single schema by URN (checks endpoint overlay first, then global) */
  getSchema(schemaUrn: string, endpointId?: string): ScimSchemaDefinition | undefined {
    if (endpointId) {
      const overlay = this.endpointOverlays.get(endpointId);
      const epSchema = overlay?.schemas.get(schemaUrn);
      if (epSchema) return epSchema;
    }
    return this.schemas.get(schemaUrn);
  }

  /**
   * All resource types with merged schema extensions for an endpoint.
   * Global resource types are deep-copied with endpoint-specific extensions appended.
   * Per-endpoint custom resource types (Phase 8b) are included.
   */
  getAllResourceTypes(endpointId?: string): ScimResourceType[] {
    const overlay = endpointId ? this.endpointOverlays.get(endpointId) : undefined;

    // Start with global resource types (User, Group) with endpoint extensions merged
    const result = [...this.resourceTypes.values()].map((rt) => {
      if (!overlay) return rt;

      const epExtensions = overlay.extensionsByResourceType.get(rt.id);
      if (!epExtensions || epExtensions.size === 0) return rt;

      // Merge: global extensions + endpoint-specific extensions
      const mergedExtensions = [...rt.schemaExtensions];
      for (const urn of epExtensions) {
        if (!mergedExtensions.some((e) => e.schema === urn)) {
          mergedExtensions.push({ schema: urn, required: false });
        }
      }
      return { ...rt, schemaExtensions: mergedExtensions };
    });

    // Append per-endpoint custom resource types (Phase 8b) with extensions merged
    if (overlay) {
      for (const customRT of overlay.resourceTypes.values()) {
        const epExtensions = overlay.extensionsByResourceType.get(customRT.id);
        if (!epExtensions || epExtensions.size === 0) {
          result.push(customRT);
        } else {
          const mergedExtensions = [...customRT.schemaExtensions];
          for (const urn of epExtensions) {
            if (!mergedExtensions.some((e) => e.schema === urn)) {
              mergedExtensions.push({ schema: urn, required: false });
            }
          }
          result.push({ ...customRT, schemaExtensions: mergedExtensions });
        }
      }
    }

    return result;
  }

  /** Get a single resource type by id (with endpoint extensions merged, or custom per-endpoint) */
  getResourceType(resourceTypeId: string, endpointId?: string): ScimResourceType | undefined {
    const rt = this.resourceTypes.get(resourceTypeId);

    // Check per-endpoint custom resource types (Phase 8b)
    if (!rt && endpointId) {
      const overlay = this.endpointOverlays.get(endpointId);
      const customRT = overlay?.resourceTypes.get(resourceTypeId);
      if (!customRT) return undefined;

      // Merge endpoint-specific extension URNs into the custom resource type
      const epExtensions = overlay?.extensionsByResourceType.get(resourceTypeId);
      if (!epExtensions || epExtensions.size === 0) return customRT;

      const mergedExtensions = [...customRT.schemaExtensions];
      for (const urn of epExtensions) {
        if (!mergedExtensions.some((e) => e.schema === urn)) {
          mergedExtensions.push({ schema: urn, required: false });
        }
      }
      return { ...customRT, schemaExtensions: mergedExtensions };
    }

    if (!rt) return undefined;
    if (!endpointId) return rt;

    const overlay = this.endpointOverlays.get(endpointId);
    const epExtensions = overlay?.extensionsByResourceType.get(resourceTypeId);
    if (!epExtensions || epExtensions.size === 0) return rt;

    const mergedExtensions = [...rt.schemaExtensions];
    for (const urn of epExtensions) {
      if (!mergedExtensions.some((e) => e.schema === urn)) {
        mergedExtensions.push({ schema: urn, required: false });
      }
    }
    return { ...rt, schemaExtensions: mergedExtensions };
  }

  /**
   * All known extension URNs across all resource types, merged with
   * endpoint-specific extensions when endpointId is provided.
   */
  getExtensionUrns(endpointId?: string): readonly string[] {
    const urns = new Set<string>();
    for (const extSet of this.extensionsByResourceType.values()) {
      for (const urn of extSet) {
        urns.add(urn);
      }
    }
    if (endpointId) {
      const overlay = this.endpointOverlays.get(endpointId);
      if (overlay) {
        for (const extSet of overlay.extensionsByResourceType.values()) {
          for (const urn of extSet) {
            urns.add(urn);
          }
        }
      }
    }
    return [...urns];
  }

  /**
   * Extension URNs for a specific resource type, merged with endpoint-specific.
   */
  getExtensionUrnsForResourceType(resourceTypeId: string, endpointId?: string): readonly string[] {
    const urns = new Set(this.extensionsByResourceType.get(resourceTypeId) ?? []);
    if (endpointId) {
      const overlay = this.endpointOverlays.get(endpointId);
      const epExts = overlay?.extensionsByResourceType.get(resourceTypeId);
      if (epExts) {
        for (const urn of epExts) urns.add(urn);
      }
    }
    return [...urns];
  }

  /**
   * ServiceProviderConfig — dynamically adjusted per-endpoint.
   *
   * When called without config, returns the default SPC (all capabilities
   * as defined in the constant). When called with an EndpointConfig,
   * adjusts capability flags based on the endpoint's configuration:
   *  - bulk.supported reflects BulkOperationsEnabled flag
   *
   * @param config - Optional per-endpoint configuration
   * @see RFC 7644 §4
   */
  getServiceProviderConfig(config?: EndpointConfig) {
    const spc = {
      ...SCIM_SERVICE_PROVIDER_CONFIG,
      bulk: { ...SCIM_SERVICE_PROVIDER_CONFIG.bulk },
    };

    if (config) {
      // Adjust bulk.supported based on endpoint config flag
      // Default is true (server supports bulk); set to false only if explicitly disabled
      const bulkEnabled = getConfigBooleanWithDefault(config, ENDPOINT_CONFIG_FLAGS.BULK_OPERATIONS_ENABLED, true);
      spc.bulk.supported = bulkEnabled;
    }

    return spc;
  }

  /** Whether a schema URN is registered (global or endpoint-specific) */
  hasSchema(schemaUrn: string, endpointId?: string): boolean {
    if (this.schemas.has(schemaUrn)) return true;
    if (endpointId) {
      const overlay = this.endpointOverlays.get(endpointId);
      if (overlay?.schemas.has(schemaUrn)) return true;
    }
    return false;
  }

  /** Whether a schema is a core (non-removable) schema */
  isCoreSchema(schemaUrn: string): boolean {
    return this.coreSchemaUrns.has(schemaUrn);
  }

  /** List all endpoint IDs that have custom overrides */
  getEndpointIds(): string[] {
    return [...this.endpointOverlays.keys()];
  }

  /** Remove all endpoint-specific extensions for an endpoint */
  clearEndpointOverlay(endpointId: string): void {
    this.endpointOverlays.delete(endpointId);
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  private getOrCreateExtensionSet(resourceTypeId: string): Set<string> {
    let set = this.extensionsByResourceType.get(resourceTypeId);
    if (!set) {
      set = new Set<string>();
      this.extensionsByResourceType.set(resourceTypeId, set);
    }
    return set;
  }

  private getOrCreateOverlay(endpointId: string): EndpointOverlay {
    let overlay = this.endpointOverlays.get(endpointId);
    if (!overlay) {
      overlay = {
        schemas: new Map(),
        extensionsByResourceType: new Map(),
        resourceTypes: new Map(),
      };
      this.endpointOverlays.set(endpointId, overlay);
    }
    return overlay;
  }

  private getOrCreateOverlayExtensionSet(overlay: EndpointOverlay, resourceTypeId: string): Set<string> {
    let set = overlay.extensionsByResourceType.get(resourceTypeId);
    if (!set) {
      set = new Set<string>();
      overlay.extensionsByResourceType.set(resourceTypeId, set);
    }
    return set;
  }
}
