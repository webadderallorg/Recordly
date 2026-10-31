# Hosted sharing

Self-hosting remains the default. Hosted sharing requires a separate operator-owned Wrangler configuration; do not commit account IDs, staging users, credentials, or real deployment URLs.

Configure the existing `DB`, `VIDEOS_BUCKET`, and `ASSETS` bindings and scheduled cleanup trigger as in `wrangler.jsonc`, then add:

- `HOSTED_MODE` set to `true`.
- `SUPABASE_URL` set to the HTTPS auth project URL.
- `SUPABASE_PUBLISHABLE_KEY` set to that project's publishable key. Never use a service-role key.
- `REQUEST_RATE_LIMIT` and `ACCOUNT_RATE_LIMIT` Cloudflare rate-limiter bindings. Hosted requests fail closed without both. Choose separate namespaces and limits suitable for video playback and multipart uploads.
- Optionally `STAGING_ALLOWED_USER_ID` to restrict a staging deployment to one verified user. Leave unset for general hosted access.

Existing databases are upgraded by `ensureSchema`; migrations 0008 and 0009 also describe the owner and upload-session schema. Legacy recordings without an owner do not appear in authenticated hosted libraries. Do not infer ownership from client-provided fields.

Deploy the worker before configuring desktop `VITE_CLOUD_SHARE_ENDPOINT` to its HTTPS `/api/upload` URL. Production builds default to cloud sharing unavailable when no endpoint is configured.

Verified accounts can hold five recordings, including pending uploads, with a maximum of 1,000,000,000 bytes each and fourteen-day expiry. These are the current free limits; this change does not implement paid entitlements. Scheduled cleanup removes expired recordings and abandoned uploads. Test with an isolated database and bucket before production rollout.
