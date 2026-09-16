import { resolveTestDatabaseUrl } from './helpers/app.helper';

describe('E2E test database URL resolution', () => {
  const fallback = 'postgresql://scim:scim@localhost:5432/scimdb';

  it('ignores an InMemory marker when the current mode is Prisma', () => {
    expect(resolveTestDatabaseUrl('inmemory', fallback)).toBe(fallback);
  });

  it.each([
    'postgresql://scim:scim@localhost:5432/scimdb',
    'postgres://scim:scim@localhost:5432/scimdb',
  ])('accepts a PostgreSQL marker: %s', (marker) => {
    expect(resolveTestDatabaseUrl(marker, fallback)).toBe(marker);
  });

  it('ignores an empty or malformed marker', () => {
    expect(resolveTestDatabaseUrl('', fallback)).toBe(fallback);
    expect(resolveTestDatabaseUrl('not-a-database-url', fallback)).toBe(fallback);
  });
});
