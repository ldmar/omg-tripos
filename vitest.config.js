import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.js'],
    // fake-indexeddb/auto se carga antes que cualquier test file
    setupFiles: ['./tests/setup.js'],
    coverage: {
      reporter: ['text', 'html'],
      include: ['parser.js', 'crdt.js', 'crypto.js', 'trips.js', 'wallet.js'],
    },
  },
});
