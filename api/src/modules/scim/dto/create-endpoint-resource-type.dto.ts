import {
  IsString,
  IsBoolean,
  IsOptional,
  IsArray,
  ValidateNested,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO for schema extension entries on a custom resource type.
 */
export class ResourceTypeSchemaExtensionDto {
  /** Full SCIM schema URN for the extension */
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  schema!: string;

  /** Whether this extension is required on the resource type */
  @IsOptional()
  @IsBoolean()
  required?: boolean;
}

/**
 * DTO for creating a custom per-endpoint SCIM resource type.
 *
 * POST /admin/endpoints/:endpointId/resource-types
 *
 * @example
 * {
 *   "name": "Device",
 *   "description": "IoT devices",
 *   "schemaUri": "urn:ietf:params:scim:schemas:core:2.0:Device",
 *   "endpoint": "/Devices",
 *   "schemaExtensions": [
 *     { "schema": "urn:example:ext:device:2.0", "required": false }
 *   ]
 * }
 */
export class CreateEndpointResourceTypeDto {
  /** Resource type name (e.g., "Device"). Must be alphanumeric, PascalCase recommended. */
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Matches(/^[A-Za-z][A-Za-z0-9]*$/, {
    message: 'name must start with a letter and contain only alphanumeric characters',
  })
  name!: string;

  /** Human-readable description of the resource type */
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  description?: string;

  /** Core schema URN for this resource type */
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  schemaUri!: string;

  /**
   * SCIM endpoint path for this resource type (e.g., "/Devices").
   * Must start with "/" and not conflict with built-in paths.
   */
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  @Matches(/^\/[A-Za-z][A-Za-z0-9]*$/, {
    message: 'endpoint must start with "/" followed by alphanumeric characters (e.g., "/Devices")',
  })
  endpoint!: string;

  /** Optional schema extensions to attach to this resource type */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ResourceTypeSchemaExtensionDto)
  schemaExtensions?: ResourceTypeSchemaExtensionDto[];
}
