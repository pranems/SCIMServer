/**
 * SCIM Bulk Request DTO — RFC 7644 §3.7
 *
 * POST /Bulk allows clients to send multiple SCIM operations
 * in a single HTTP request. Each operation specifies a method,
 * path, and optional data payload.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7644#section-3.7
 */
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Schema URN for SCIM Bulk Request messages */
export const SCIM_BULK_REQUEST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:BulkRequest';

/** Schema URN for SCIM Bulk Response messages */
export const SCIM_BULK_RESPONSE_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:BulkResponse';

/**
 * Maximum number of operations allowed in a single bulk request.
 * Advertised in ServiceProviderConfig.bulk.maxOperations.
 */
export const BULK_MAX_OPERATIONS = 1000;

/**
 * Maximum payload size in bytes for a bulk request (1 MB).
 * Advertised in ServiceProviderConfig.bulk.maxPayloadSize.
 */
export const BULK_MAX_PAYLOAD_SIZE = 1_048_576;

/**
 * A single operation within a SCIM Bulk request.
 *
 * @example
 * {
 *   "method": "POST",
 *   "path": "/Users",
 *   "bulkId": "user1",
 *   "data": { "schemas": [...], "userName": "alice@example.com" }
 * }
 */
export class BulkOperationDto {
  /** HTTP method for this operation */
  @IsString()
  @IsIn(['POST', 'PUT', 'PATCH', 'DELETE'], {
    message: 'method must be one of: POST, PUT, PATCH, DELETE',
  })
  method!: string;

  /**
   * SCIM resource path (e.g., "/Users", "/Users/{id}", "/Groups/{id}").
   * For POST, path is the resource type endpoint (e.g., "/Users").
   * For PUT/PATCH/DELETE, path includes the resource ID (e.g., "/Users/abc-123").
   */
  @IsString()
  @MaxLength(2000, { message: 'path is too long (max 2000 characters).' })
  path!: string;

  /**
   * Client-assigned identifier for correlating operations within a bulk request.
   * Required for POST operations so other operations can reference the created resource
   * via "bulkId:<value>" syntax.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'bulkId is too long (max 200 characters).' })
  bulkId?: string;

  /**
   * Resource version for conditional writes (PUT/PATCH/DELETE).
   * Maps to the If-Match header for individual operations.
   * @example "W/\"v3\""
   */
  @IsOptional()
  @IsString()
  version?: string;

  /**
   * The operation payload (request body).
   * Required for POST, PUT, PATCH. Not used for DELETE.
   */
  @IsOptional()
  data?: Record<string, unknown>;
}

/**
 * SCIM Bulk Request DTO.
 *
 * @example
 * {
 *   "schemas": ["urn:ietf:params:scim:api:messages:2.0:BulkRequest"],
 *   "failOnErrors": 3,
 *   "Operations": [
 *     { "method": "POST", "path": "/Users", "bulkId": "u1", "data": {...} },
 *     { "method": "PATCH", "path": "/Users/abc-123", "data": {...} }
 *   ]
 * }
 */
export class BulkRequestDto {
  @IsArray()
  @ArrayNotEmpty()
  schemas!: string[];

  /**
   * Maximum number of errors before the server stops processing.
   * 0 means process all operations regardless of errors.
   * @default 0
   */
  @IsOptional()
  @IsInt({ message: 'failOnErrors must be an integer.' })
  @Min(0, { message: 'failOnErrors must be >= 0.' })
  @Max(BULK_MAX_OPERATIONS, { message: `failOnErrors cannot exceed ${BULK_MAX_OPERATIONS}.` })
  failOnErrors?: number;

  @IsArray()
  @ArrayNotEmpty({ message: 'Operations array must not be empty.' })
  @ArrayMaxSize(BULK_MAX_OPERATIONS, {
    message: `Operations array cannot exceed ${BULK_MAX_OPERATIONS} elements.`,
  })
  @ValidateNested({ each: true })
  @Type(() => BulkOperationDto)
  Operations!: BulkOperationDto[];
}

/**
 * Result of a single bulk operation (used in BulkResponse).
 */
export interface BulkOperationResult {
  /** HTTP method that was executed */
  method: string;

  /** Client-assigned bulkId (echoed back if provided) */
  bulkId?: string;

  /** Resource version after the operation (ETag value) */
  version?: string;

  /** Absolute or relative URL of the resource */
  location?: string;

  /** HTTP status code as a string (per RFC 7644 §3.7) */
  status: string;

  /** SCIM error response body (only on failure) */
  response?: {
    schemas?: string[];
    scimType?: string;
    detail?: string;
    status?: string;
  };
}

/**
 * SCIM Bulk Response shape.
 */
export interface BulkResponse {
  schemas: string[];
  Operations: BulkOperationResult[];
}
