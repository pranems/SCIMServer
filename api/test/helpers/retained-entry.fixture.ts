import type { SchemaAttributeDefinition } from '../../src/domain/validation/validation-types';

export interface RetainedEntryCase {
  name: string;
  before: Record<string, unknown>[];
  after: Record<string, unknown>[];
  expected: Record<string, unknown>[];
}

export const retainedEntryCases: RetainedEntryCase[] = [
  {
    name: 'omitted type reserves a later explicit type match',
    before: [
      { value: 'same', type: 'work', server: 'work-owned' },
      { value: 'same', type: 'home', server: 'home-owned' },
    ],
    after: [{ value: 'same' }, { value: 'same', type: 'work' }],
    expected: [{ value: 'same', server: 'home-owned' }, { value: 'same', type: 'work', server: 'work-owned' }],
  },
  {
    name: 'changed type reserves a later explicit type match',
    before: [
      { value: 'same', type: 'work', server: 'work-owned' },
      { value: 'same', type: 'home', server: 'home-owned' },
    ],
    after: [{ value: 'same', type: 'other' }, { value: 'same', type: 'work' }],
    expected: [
      { value: 'same', type: 'other', server: 'home-owned' },
      { value: 'same', type: 'work', server: 'work-owned' },
    ],
  },
  {
    name: 'duplicate values reordered by type',
    before: [
      { value: 'same', type: 'work', server: 'work-owned' },
      { value: 'same', type: 'home', server: 'home-owned' },
    ],
    after: [{ value: 'same', type: 'home' }, { value: 'same', type: 'work' }],
    expected: [
      { value: 'same', type: 'home', server: 'home-owned' },
      { value: 'same', type: 'work', server: 'work-owned' },
    ],
  },
  {
    name: 'same-value same-type occurrences are consumed once',
    before: [
      { value: 'same', type: 'work', server: 'first' },
      { value: 'same', type: 'work', server: 'second' },
    ],
    after: [{ value: 'same', type: 'work' }, { value: 'same', type: 'work' }, { value: 'same', type: 'work' }],
    expected: [
      { value: 'same', type: 'work', server: 'first' },
      { value: 'same', type: 'work', server: 'second' },
      { value: 'same', type: 'work' },
    ],
  },
  {
    name: 'anonymous entries retain their occurrence order',
    before: [{ server: 'first-anonymous' }, { value: 'removed', server: 'removed' }, { server: 'second-anonymous' }],
    after: [{ value: 'added' }, {}, {}, {}],
    expected: [{ value: 'added' }, { server: 'first-anonymous' }, { server: 'second-anonymous' }, {}],
  },
  {
    name: 'removed and added identities do not transfer server state',
    before: [{ value: 'removed', server: 'removed-owned' }, { value: 'retained', server: 'retained-owned' }],
    after: [{ value: 'retained' }, { value: 'added' }],
    expected: [{ value: 'retained', server: 'retained-owned' }, { value: 'added' }],
  },
  {
    name: 'case-insensitive identity field names retain their matched state',
    before: [{ VALUE: 'same', TYPE: 'work', server: 'work-owned' }, { Value: 'same', Type: 'home', server: 'home-owned' }],
    after: [{ value: 'same', type: 'home' }, { value: 'same', type: 'work' }],
    expected: [
      { value: 'same', type: 'home', server: 'home-owned' },
      { value: 'same', type: 'work', server: 'work-owned' },
    ],
  },
];

export function retainedRecordsAttribute(mutability: 'readWrite' | 'readOnly' | 'immutable'): SchemaAttributeDefinition {
  return {
    name: 'records', type: 'complex', multiValued: true, required: false,
    subAttributes: [
      { name: 'value', type: 'string', multiValued: false, required: false },
      { name: 'type', type: 'string', multiValued: false, required: false },
      { name: 'server', type: 'string', multiValued: false, required: false, mutability },
    ],
  };
}
