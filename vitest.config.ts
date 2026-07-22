import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  resolve: {
    // Source files import internal modules through the `@/*` path aliases with a
    // `.js` extension (TypeScript's ESM convention). Rewrite those to the actual
    // `.ts` source files so the test runner resolves them the same way tsc does.
    alias: [{ find: /^@\/(.*)\.js$/, replacement: `${srcDir}/$1.ts` }],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
