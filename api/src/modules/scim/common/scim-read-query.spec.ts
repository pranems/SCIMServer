import type { SchemaAttributeDefinition, SchemaDefinition } from '../../../domain/validation';
import {
  buildGenericFilter,
  buildGroupFilter,
  buildUserFilter,
} from '../filters/apply-scim-filter';
import { createReadQuery, type ReadQueryParams } from './scim-read-query';
import { stripNeverReturnedFromPayload } from './scim-service-helpers';

const CORE = 'urn:example:query:Core';
const EXT = 'urn:example:query:Extension';
const attr = (
  name: string,
  options: Partial<SchemaAttributeDefinition> = {},
): SchemaAttributeDefinition => ({
  name,
  type: 'string',
  multiValued: false,
  required: false,
  ...options,
});
const schemas: SchemaDefinition[] = [
  {
    id: CORE,
    isCoreSchema: true,
    attributes: [
      attr('code'),
      attr('rank', { type: 'decimal' }),
      attr('date', { type: 'dateTime' }),
      attr('values', { type: 'integer', multiValued: true }),
      attr('entry', { type: 'complex', subAttributes: [attr('value', { type: 'integer' })] }),
      attr('private', { type: 'complex', mutability: 'writeOnly', subAttributes: [attr('value')] }),
      attr('entries', {
        type: 'complex',
        multiValued: true,
        subAttributes: [attr('code'), attr('primary', { type: 'boolean' })],
      }),
    ],
  },
  {
    id: EXT,
    attributes: [
      attr('code', { caseExact: true }),
      attr('entries', {
        type: 'complex',
        multiValued: true,
        subAttributes: [
          attr('code', { caseExact: true }),
          attr('secret', { mutability: 'writeOnly' }),
        ],
      }),
    ],
  },
];

function page(params: ReadQueryParams, rows: Record<string, unknown>[], limit = 100) {
  return createReadQuery(params, schemas, limit, buildUserFilter).page(
    rows,
    (r) => r,
    (r) => r,
  );
}

describe('Shared read query plan', () => {
  it.each(['displayName', 'active'])(
    'retains numeric and multi-valued %s candidates instead of using a string column',
    (name) => {
      for (const definition of [
        attr(name, { type: 'integer' }),
        attr(name, { multiValued: true }),
      ]) {
        const definitions: SchemaDefinition[] = [
          { id: CORE, isCoreSchema: true, attributes: [definition] },
        ];
        const numeric = definition.type === 'integer';
        const rows = [{ id: 'matching', [name]: numeric ? 2 : ['unrelated', 'needle'] }];
        for (const filter of [`${name} eq ${numeric ? '2' : '"needle"'}`, `${name} pr`]) {
          const query = createReadQuery({ filter }, definitions, 100, buildGenericFilter);
          expect(query.dbWhere).toEqual({});
          expect(
            query.page(
              rows,
              (r) => r,
              (r) => r,
            ).Resources,
          ).toEqual(rows);
        }
      }
    },
  );

  it.each([buildUserFilter, buildGroupFilter, buildGenericFilter])(
    '%p applies fixed common externalId caseExact independently of extension homonyms',
    (build) => {
      const definitions: SchemaDefinition[] = [
        { id: CORE, isCoreSchema: true, attributes: [attr('externalId', { caseExact: false })] },
        { id: EXT, attributes: [attr('externalId', { caseExact: false })] },
      ];
      const rows = [
        { id: 'upper', externalId: 'Z', [EXT]: { externalId: 'Z' } },
        { id: 'lower', externalId: 'a', [EXT]: { externalId: 'a' } },
      ];
      for (const path of ['externalId', `${CORE}:externalId`]) {
        const exact = createReadQuery({ filter: `${path} eq "z"` }, definitions, 100, build);
        expect(
          exact.page(
            rows,
            (r) => r,
            (r) => r,
          ).Resources,
        ).toEqual([]);
        const sort = createReadQuery({ sortBy: path }, definitions, 100, build);
        expect(
          sort.page(
            rows,
            (r) => r,
            (r) => r,
          ).Resources,
        ).toEqual(rows);
      }
      const extension = createReadQuery(
        { filter: `${EXT}:externalId eq "z"` },
        definitions,
        100,
        build,
      );
      expect(
        extension.page(
          rows,
          (r) => r,
          (r) => r,
        ).Resources,
      ).toEqual([rows[0]]);
    },
  );

  it.each([
    { type: 'integer', multiValued: false, value: 2, literal: '2' },
    { type: 'string', multiValued: true, value: ['other', 'needle'], literal: '"needle"' },
  ])('preserves independent extension externalId $type/$multiValued semantics', (shape) => {
    const definitions: SchemaDefinition[] = [
      { id: CORE, isCoreSchema: true, attributes: [] },
      { id: EXT, attributes: [attr('externalId', shape)] },
    ];
    const rows = [{ externalId: 'common-string', [EXT]: { externalId: shape.value } }];
    const query = createReadQuery(
      { filter: `${EXT}:externalId eq ${shape.literal}` },
      definitions,
      100,
      buildGenericFilter,
    );
    expect(query.dbWhere).toEqual({});
    expect(
      query.page(
        rows,
        (r) => r,
        (r) => r,
      ).Resources,
    ).toEqual(rows);
  });

  it('does not remove an existing writeOnly denial when enforcing common externalId shape', () => {
    const definitions: SchemaDefinition[] = [
      {
        id: CORE,
        isCoreSchema: true,
        attributes: [attr('externalId', { mutability: 'writeOnly' })],
      },
    ];
    expect(() =>
      createReadQuery({ filter: 'externalId pr' }, definitions, 100, buildGenericFilter),
    ).toThrow();
  });

  it('keeps string-column push-down for compatible scalar custom attributes', () => {
    for (const name of ['displayName', 'externalId']) {
      const definitions: SchemaDefinition[] = [
        {
          id: CORE,
          isCoreSchema: true,
          attributes: [attr(name, { caseExact: name === 'externalId' })],
        },
      ];
      const query = createReadQuery(
        { filter: `${name} eq "needle"` },
        definitions,
        100,
        buildGenericFilter,
      );
      expect(query.dbWhere).toEqual(
        name === 'externalId'
          ? { externalId: 'needle' }
          : { displayName: { equals: 'needle', mode: 'insensitive' } },
      );
    }
  });

  it('does not push null literals into nonnullable database fields', () => {
    const query = createReadQuery({ filter: 'id eq null' }, schemas, 100, buildUserFilter);
    expect(query.dbWhere).toEqual({});
    expect(
      query.page(
        [{ id: 'present' }],
        (r) => r,
        (r) => r,
      ).totalResults,
    ).toBe(0);
  });
  it('requires a scalar sub-attribute when sorting complex values', () => {
    expect(() => page({ sortBy: 'entry' }, [])).toThrow();
  });

  it('sorts strings using the selected namespace caseExact rather than a flattened name', () => {
    const rows = [
      { code: 'Z', [EXT]: { code: 'Z' } },
      { code: 'a', [EXT]: { code: 'a' } },
    ];
    expect(page({ sortBy: 'code' }, rows).Resources).toEqual([rows[1], rows[0]]);
    expect(page({ sortBy: `${EXT}:code` }, rows).Resources).toEqual(rows);
  });

  it.each(['values', 'entry.value'])('sorts %s by its first/simple value', (sortBy) => {
    const rows = [
      { id: 'ten', values: [10, 1], entry: { value: 10 } },
      { id: 'two', values: [2, 99], entry: { value: 2 } },
      { id: 'missing', values: [], entry: {} },
    ];
    expect(page({ sortBy }, rows).Resources.map((r) => r.id)).toEqual(['two', 'ten', 'missing']);
  });

  it('does not collapse caseExact across namespaces or valuePath parents', () => {
    const rows = [
      {
        code: 'AbC',
        entries: [{ code: 'AbC' }],
        [EXT]: { code: 'AbC', entries: [{ code: 'AbC' }] },
      },
    ];
    for (const filter of ['code eq "abc"', `${CORE}:code eq "abc"`, 'entries[code eq "abc"]']) {
      expect(page({ filter }, rows).totalResults).toBe(1);
    }
    for (const filter of [`${EXT}:code eq "abc"`, `${EXT}:entries[code eq "abc"]`]) {
      expect(page({ filter }, rows).totalResults).toBe(0);
    }
  });

  it.each(['eq', 'ne', 'co', 'sw', 'ew', 'gt', 'ge', 'lt', 'le'])(
    'uses caseExact with %s',
    (op) => {
      const rows = [{ [EXT]: { code: 'AbC' } }];
      const expected = ['ne', 'lt', 'le'].includes(op) ? 1 : 0;
      expect(page({ filter: `${EXT}:code ${op} "abc"` }, rows).totalResults).toBe(expected);
    },
  );

  it('compares dates by instant, decimal values numerically and missing values last/first', () => {
    const rows = [
      { id: 'later', date: '2025-12-31T23:00:00Z', rank: 10.5 },
      { id: 'earlier', date: '2026-01-01T00:30:00+02:00', rank: 2.5 },
      { id: 'missing' },
    ];
    for (const sortBy of ['date', 'rank']) {
      expect(page({ sortBy }, rows).Resources.map((r) => r.id)).toEqual([
        'earlier',
        'later',
        'missing',
      ]);
      expect(page({ sortBy, sortOrder: 'descending' }, rows).Resources.map((r) => r.id)).toEqual([
        'missing',
        'later',
        'earlier',
      ]);
    }
    expect(page({ filter: 'date lt "2025-12-31T23:00:00Z"' }, rows).Resources).toEqual([rows[1]]);
  });

  it('counts the full match set before pagination, never mutates input, projects only the page', () => {
    const rows = Array.from({ length: 130 }, (_, rank) => ({
      rank,
      hidden: 'internal',
      id: String(rank),
    }));
    const original = JSON.stringify(rows);
    const project = jest.fn((r: Record<string, unknown>) => ({ id: r.id }));
    const query = createReadQuery(
      { filter: 'rank ge 100', sortBy: 'rank', startIndex: 3, count: 500 },
      schemas,
      2,
      buildUserFilter,
    );
    expect(query.page(rows, (r) => r, project)).toEqual({
      totalResults: 30,
      startIndex: 3,
      itemsPerPage: 2,
      Resources: [{ id: '102' }, { id: '103' }],
    });
    expect(project).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(rows)).toBe(original);
    expect(page({ count: 0 }, rows)).toMatchObject({
      totalResults: 130,
      itemsPerPage: 0,
      Resources: [],
    });
    expect(page({ count: -1, startIndex: 0 }, rows)).toMatchObject({
      startIndex: 1,
      itemsPerPage: 0,
    });
  });

  it.each([
    'private.value pr',
    `${EXT}:entries[secret pr]`,
    `${EXT}:entries[unknown pr]`,
    'entries[primary gt true]',
  ])('rejects unauthorized/invalid operand %s', (filter) => {
    expect(() => page({ filter }, [])).toThrow();
  });

  it('suppresses never/writeOnly children even without any hidden top-level attribute', () => {
    const payload = {
      entries: [{ code: 'visible', secret: 'hidden' }],
      [EXT]: { entries: [{ code: 'visible', secret: 'hidden' }] },
    };
    const byParent = new Map([
      [`${CORE.toLowerCase()}.entries`, new Set(['secret'])],
      [`${EXT.toLowerCase()}.entries`, new Set(['secret'])],
    ]);
    stripNeverReturnedFromPayload(payload, byParent, CORE.toLowerCase(), [EXT]);
    expect(payload).toEqual({
      entries: [{ code: 'visible' }],
      [EXT]: { entries: [{ code: 'visible' }] },
    });
  });
});
