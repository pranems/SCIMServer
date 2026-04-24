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
  collectCoverageFrom: [
    'src/**/*.(t|j)s',
    '!src/main.ts',
    '!src/**/*.module.ts',
    '!src/**/*.dto.ts',
    '!src/**/*.interface.ts',
  ],
  coverageDirectory: 'coverage-e2e',
  // Parallel execution: each test creates its own endpoint UUID, so SCIM
  // data is fully isolated. globalTeardown truncates all tables after the run.
  // Workers share the same PostgreSQL database but never touch each other's endpoints.
  maxWorkers: 4,
  // E2E setup - bootstrap app + DB before all suites
  globalSetup: '<rootDir>/test/e2e/global-setup.ts',
  globalTeardown: '<rootDir>/test/e2e/global-teardown.ts',
  // JSON results reporter - writes test-results/e2e-results-<timestamp>.json
  reporters: [
    'default',
    '<rootDir>/test/e2e/reporters/json-results-reporter.ts',
  ],
};

export default config;
