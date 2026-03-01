/**
 * IGenericResourceRepository — persistence port for custom SCIM resource types.
 *
 * Phase 8b: Generic resources are stored in the polymorphic ScimResource table
 * with an arbitrary resourceType discriminator. All queries are scoped by
 * both endpointId AND resourceType to ensure proper data isolation.
 */
import type {
  GenericResourceRecord,
  GenericResourceCreateInput,
  GenericResourceUpdateInput,
} from '../models/generic-resource.model';

export interface IGenericResourceRepository {
  /** Create a new generic resource and return the complete record. */
  create(input: GenericResourceCreateInput): Promise<GenericResourceRecord>;

  /** Find a generic resource by its SCIM-visible id within an endpoint + resourceType. */
  findByScimId(
    endpointId: string,
    resourceType: string,
    scimId: string,
  ): Promise<GenericResourceRecord | null>;

  /**
   * List generic resources for an endpoint + resourceType, optionally filtered.
   *
   * @param endpointId   Endpoint identifier (mandatory for isolation)
   * @param resourceType Resource type discriminator (e.g., "Device")
   * @param dbFilter     Simple key-value filter pushed down from the SCIM filter parser
   */
  findAll(
    endpointId: string,
    resourceType: string,
    dbFilter?: Record<string, unknown>,
  ): Promise<GenericResourceRecord[]>;

  /** Update a generic resource by its internal storage ID. */
  update(id: string, data: GenericResourceUpdateInput): Promise<GenericResourceRecord>;

  /** Delete a generic resource by its internal storage ID. */
  delete(id: string): Promise<void>;

  /** Find a resource by externalId within an endpoint + resourceType. */
  findByExternalId(
    endpointId: string,
    resourceType: string,
    externalId: string,
  ): Promise<GenericResourceRecord | null>;

  /** Find a resource by displayName within an endpoint + resourceType. */
  findByDisplayName(
    endpointId: string,
    resourceType: string,
    displayName: string,
  ): Promise<GenericResourceRecord | null>;
}
