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
  // Run sequentially — E2E tests share a single SQLite DB file
  maxWorkers: 1,
  // E2E setup — bootstrap app + DB before all suites
  globalSetup: '<rootDir>/test/e2e/global-setup.ts',
  globalTeardown: '<rootDir>/test/e2e/global-teardown.ts',
};

export default config;
