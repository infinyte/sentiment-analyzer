/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
  },
  // Allow imports with .js extension to resolve to .ts files (ESM compat)
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  clearMocks: true,
  restoreMocks: true,
  // Force-exit after all tests complete to close the Express server handle
  // that app.listen() opens when index.ts is imported in integration tests.
  forceExit: true,
  // Suppress console output in tests unless there's a failure
  silent: false,
};
