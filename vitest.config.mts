/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 10000,
    maxConcurrency: 1,
    sequence: {
      concurrent: false,
    },
  },
});
