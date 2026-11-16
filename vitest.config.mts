import { defineConfig } from 'vitest/config';

// Vitest covers pure TypeScript only (the rotation engine and other non-UI code).
// Tests run under plain Node with no React Native runtime.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
