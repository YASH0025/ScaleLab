import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests run full simulations, which are slow when every package tests at once.
    testTimeout: 60_000,
  },
});
