import { Validate, ValidatorConstraint, type ValidationArguments, type ValidatorConstraintInterface } from 'class-validator';

export type SearchAttributeSelection = string | string[];

const MAX_SELECTION_LENGTH = 2000;
const MAX_SELECTION_ITEMS = 100;

@ValidatorConstraint({ name: 'searchAttributeSelection', async: false })
export class SearchAttributeSelectionConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value === 'string') return value.length <= MAX_SELECTION_LENGTH;
    if (!Array.isArray(value) || value.length > MAX_SELECTION_ITEMS) return false;
    if (!value.every((item: unknown) =>
      typeof item === 'string' && item.trim().length > 0 && !item.includes(','))) return false;
    return value.join(',').length <= MAX_SELECTION_LENGTH;
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be a comma-separated string or an array of at most ${MAX_SELECTION_ITEMS} non-empty attribute strings without commas (max ${MAX_SELECTION_LENGTH} characters including separators).`;
  }
}

export const IsSearchAttributeSelection = () => Validate(SearchAttributeSelectionConstraint);

/** Adapt validated JSON search input to the existing URL-style projection API. */
export function searchAttributeSelectionToQuery(value?: SearchAttributeSelection): string | undefined {
  return Array.isArray(value) ? value.join(',') : value;
}
