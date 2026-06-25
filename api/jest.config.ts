import type { Config } from 'jest';

const config: Config = {
  verbose: true,
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  moduleNameMapper: {
    '^@app/(.*)$': '<rootDir>/src/$1'
  },
  transform: {
    // `allowJs` lets ts-jest down-compile the ESM-only `jose` package (see
    // transformIgnorePatterns below) from ESM to CommonJS for the CJS test runtime.
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: { allowJs: true } }]
  },
  // `jose` v6 is published ESM-only. Jest runs the suite as CommonJS, so the
  // package must be transformed rather than left to the runtime `require()`
  // (which throws `SyntaxError: Unexpected token 'export'`). Everything else in
  // node_modules stays ignored for transform speed.
  transformIgnorePatterns: ['/node_modules/(?!jose/)'],
  collectCoverageFrom: [
    'src/**/*.(t|j)s',
    '!src/main.ts',
    '!src/**/*.module.ts',
    '!src/**/*.dto.ts',
    '!src/**/*.interface.ts',
  ],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: {
      branches: 75,
      functions: 90,
      lines: 80,
      statements: 80,
    },
  },
  testRegex: '.*\\.spec\\.ts$'
};

export default config;
