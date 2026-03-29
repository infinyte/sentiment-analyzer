/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: 'tsconfig.jest.json',
      // TS2823: import attributes not supported in CommonJS mode — ts-jest still
      // compiles the import correctly (strips 'with' clause → plain require()),
      // so we suppress the diagnostic rather than changing the module target.
      diagnostics: {
        ignoreCodes: ['TS2823'],
        // worker-pool.ts uses import.meta.url (ESM-only). ts-jest adds it to the
        // compilation unit when app.ts imports it, even though moduleNameMapper
        // redirects the runtime import to the CJS-compatible manual mock.
        // Exclude diagnostics for that file only — TS1343 stays active everywhere else.
        exclude: ['**/services/worker-pool.ts'],
      },
    }],
  },
  // Allow imports with .js extension to resolve to .ts files (ESM compat)
  moduleNameMapper: {
    // worker-pool.ts uses import.meta.url (ESM-only) which ts-jest cannot compile
    // in CommonJS mode. Redirect ALL imports (relative or absolute) to the
    // CJS-compatible manual mock.  Pattern must match both:
    //   './worker-pool.js'          (from sibling files in services/)
    //   './services/worker-pool.js' (from src/ root)
    //   '../services/worker-pool.js' (from routes/)
    '.*worker-pool(\\.js)?$': '<rootDir>/src/services/__mocks__/worker-pool.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  setupFiles: ['<rootDir>/src/__tests__/setup-env.ts'],
  clearMocks: true,
  restoreMocks: true,
  // Suppress console output in tests unless there's a failure
  silent: false,
};
