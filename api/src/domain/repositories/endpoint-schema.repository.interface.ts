/**
 * IEndpointSchemaRepository — repository interface for persisted
 * per-endpoint SCIM schema extensions.
 */
import type { EndpointSchemaRecord, EndpointSchemaCreateInput } from '../models/endpoint-schema.model';

export interface IEndpointSchemaRepository {
  /** Create a new endpoint schema extension */
  create(input: EndpointSchemaCreateInput): Promise<EndpointSchemaRecord>;

  /** Find all schema extensions for a specific endpoint */
  findByEndpointId(endpointId: string): Promise<EndpointSchemaRecord[]>;

  /** Find all schema extensions across all endpoints */
  findAll(): Promise<EndpointSchemaRecord[]>;

  /** Find a specific extension by endpoint + URN */
  findByEndpointAndUrn(endpointId: string, schemaUrn: string): Promise<EndpointSchemaRecord | null>;

  /** Delete a specific extension by endpoint + URN */
  deleteByEndpointAndUrn(endpointId: string, schemaUrn: string): Promise<boolean>;

  /** Delete all extensions for an endpoint */
  deleteByEndpointId(endpointId: string): Promise<number>;
}
