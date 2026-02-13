import type { Config } from 'jest';

const config: Config = {
  verbose: true,
  rootDir: '../..',
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  moduleNameMapper: {
    '^@app/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  testRegex: '.*\\.e2e-spec\\.ts$',
  testTimeout: 30_000,
  // SQLite compromise: E2E tests must run sequentially because SQLite’s single-file
  // database cannot handle concurrent access from multiple Jest workers.
  // PostgreSQL migration: set maxWorkers to 4+ and use isolated test schemas.
  // See docs/SQLITE_COMPROMISE_ANALYSIS.md §3.2.5
  maxWorkers: 1,
  // E2E setup — bootstrap app + DB before all suites
  globalSetup: '<rootDir>/test/e2e/global-setup.ts',
  globalTeardown: '<rootDir>/test/e2e/global-teardown.ts',
};

export default config;
