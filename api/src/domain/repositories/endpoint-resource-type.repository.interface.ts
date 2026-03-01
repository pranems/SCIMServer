/**
 * IEndpointResourceTypeRepository — repository interface for persisted
 * per-endpoint custom SCIM resource type registrations.
 *
 * Phase 8b: Provides CRUD operations for custom resource types. The
 * ScimSchemaRegistry hydrates from these records on startup.
 */
import type { EndpointResourceTypeRecord, EndpointResourceTypeCreateInput } from '../models/endpoint-resource-type.model';

export interface IEndpointResourceTypeRepository {
  /** Create a new custom resource type registration */
  create(input: EndpointResourceTypeCreateInput): Promise<EndpointResourceTypeRecord>;

  /** Find all resource type registrations for a specific endpoint */
  findByEndpointId(endpointId: string): Promise<EndpointResourceTypeRecord[]>;

  /** Find all resource type registrations across all endpoints */
  findAll(): Promise<EndpointResourceTypeRecord[]>;

  /** Find a specific resource type by endpoint + name */
  findByEndpointAndName(endpointId: string, name: string): Promise<EndpointResourceTypeRecord | null>;

  /** Delete a specific resource type by endpoint + name */
  deleteByEndpointAndName(endpointId: string, name: string): Promise<boolean>;

  /** Delete all resource type registrations for an endpoint */
  deleteByEndpointId(endpointId: string): Promise<number>;
}
