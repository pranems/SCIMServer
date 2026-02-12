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
    '^.+\\.(t|j)s$': 'ts-jest'
  },
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
