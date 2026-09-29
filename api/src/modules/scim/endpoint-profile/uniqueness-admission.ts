import { RepositoryError } from '../../../domain/errors/repository-error';
import { compileEffectiveUniquenessPolicy, compileUniquenessPolicy } from '../../../domain/repositories/uniqueness-policy';
import type { EndpointProfile } from './endpoint-profile.types';
import type { ProfileValidationError } from './endpoint-profile.service';

/** Runs only after structural validation has resolved every referenced schema. */
export function validateUniquenessCapabilities(profile: EndpointProfile): ProfileValidationError[] {
  const schemas = new Map(profile.schemas.map(schema => [schema.id, schema]));
  const extensionSchemas = new Set(profile.resourceTypes.flatMap(rt => rt.schemaExtensions.map(ext => ext.schema)));
  const errors: ProfileValidationError[] = [];
  for (const rt of profile.resourceTypes) {
    const core = { ...schemas.get(rt.schema)!, isCoreSchema: true };
    const bindings = [
      core,
      ...rt.schemaExtensions.map(ext => ({ ...schemas.get(ext.schema)!, isCoreSchema: false })),
    ];
    try {
      // A core-only declaration cannot advertise an unsupported computed promise.
      // Shared declarations instead describe extension values; the core binding takes RFC precedence.
      if (!extensionSchemas.has(rt.schema)) compileUniquenessPolicy([core]);
      compileEffectiveUniquenessPolicy(bindings);
    } catch (error) {
      if (!(error instanceof RepositoryError) || error.code !== 'INVALID_VALUE') throw error;
      errors.push({ code: 'UNSUPPORTED_DECLARATION', detail: `ResourceType "${rt.name}": ${error.message}` });
    }
  }
  return errors;
}
