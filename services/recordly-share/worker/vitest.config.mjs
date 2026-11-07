import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.test.jsonc' },
      miniflare: {
        bindings: {
          API_SECRET: 'test-secret',
          ALLOW_API_SECRET_UPLOADS: 'true',
        },
      },
    }),
  ],
  test: {
    // The worker caches schemaReady at module level. Share one runtime and D1
    // store across files so cached initialization still refers to existing tables.
    // Individual tests create their own rows rather than relying on rollback.
    maxWorkers: 1,
    isolate: false,
  },
});
