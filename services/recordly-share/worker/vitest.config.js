import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        // The worker caches `schemaReady` at module level, so per-test storage
        // rollback would leave the flag true with the tables gone. Tests create
        // their own rows and don't depend on a clean DB.
        isolatedStorage: false,
        singleWorker: true,
        wrangler: { configPath: './wrangler.test.jsonc' },
        miniflare: {
          bindings: {
            API_SECRET: 'test-secret',
            ALLOW_API_SECRET_UPLOADS: 'true',
          },
        },
      },
    },
  },
});
