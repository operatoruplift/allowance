import { defineConfig } from 'vitest/config';
export default defineConfig({
  // `.tsx` is included so a component can be rendered to markup and asserted on
  // (react-dom/server needs no DOM), rather than described in a comment.
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['tests/browser/**'],
    testTimeout: 20000,
  },
});
