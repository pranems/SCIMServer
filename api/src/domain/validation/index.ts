/**
 * Domain Validation — barrel export (Phase 8)
 */
export { SchemaValidator } from './schema-validator';

export type {
  ValidationError,
  ValidationWarning,
  ValidationResult,
  SchemaAttributeDefinition,
  SchemaDefinition,
  SchemaCharacteristicsCache,
  ValidationOptions,
} from './validation-types';

export { SCHEMA_CACHE_TOP_LEVEL } from './validation-types';