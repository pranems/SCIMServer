import {
  IsString,
  IsBoolean,
  IsOptional,
  IsArray,
  ValidateNested,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO for the `attributes` array entries in a SCIM schema.
 * Matches the RFC 7643 §7 Schema Attribute format.
 */
export class SchemaAttributeDto {
  @IsString()
  name!: string;

  @IsString()
  type!: string;

  @IsBoolean()
  multiValued!: boolean;

  @IsBoolean()
  required!: boolean;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  mutability?: string;

  @IsOptional()
  @IsString()
  returned?: string;

  @IsOptional()
  @IsBoolean()
  caseExact?: boolean;

  @IsOptional()
  @IsString()
  uniqueness?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  referenceTypes?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SchemaAttributeDto)
  subAttributes?: SchemaAttributeDto[];
}

/**
 * DTO for creating a per-endpoint SCIM schema extension.
 *
 * POST /admin/endpoints/:endpointId/schemas
 */
export class CreateEndpointSchemaDto {
  /** Full SCIM schema URN, e.g. "urn:ietf:params:scim:schemas:extension:custom:2.0:User" */
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  schemaUrn!: string;

  /** Human-readable name (e.g. "Custom User Extension") */
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  /** Optional description */
  @IsOptional()
  @IsString()
  description?: string;

  /** Resource type to attach to (e.g. "User" or "Group"). Optional. */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  resourceTypeId?: string;

  /** Whether this extension is required on the resource type (default false) */
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  /** RFC 7643 §7 schema attribute definitions */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SchemaAttributeDto)
  attributes!: SchemaAttributeDto[];
}
