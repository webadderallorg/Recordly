# Cloudflare staging

Provisioned on 2026-09-23 in account `b000d832666fb4eb4bc63df58fecbb11`:

- D1: `recordly-share-staging-db`, ID `1d930cc5-644f-4b29-932d-ef75257b2f8c`.
- R2: `recordly-videos-staging`, Standard storage, automatically placed in Oceania. Public access is disabled; the bucket is empty.
- D1 initialized using `schema.sql`. Verified tables: chapters, comment_sessions, comment_users, comments, password_attempts, reactions, transcript_segments, videos. No customer data inserted.

The owner-approved staging Worker is deployed at `https://recordly-share-staging.youngchen3442.workers.dev`, version `81cf4abb-5703-4f4c-b74b-54ff428009d7`. Existing `landingvideos` storage and DNS were not changed. Wrangler uses an approved OAuth grant limited to account/user read, Worker-script write, and background access; no DNS/zone/D1 write scopes were granted.

## Local validation

Use `wrangler.staging.jsonc` explicitly. The default self-host configuration is unchanged. The owner approved an isolated public staging deployment on 2026-09-23. Staging enables workers.dev but disables preview URLs, custom-domain routes and API-secret uploads. The ignored `.wrangler/staging-deploy.json` includes the existing Supabase URL and publishable key; no service-role key is used. The deployment is live. Use `--experimental-provision=false` with Wrangler 4.99.0: existing resources are already configured and verified, so automatic provisioning is unnecessary and requires additional R2 permissions. The local-only `service_binding_extra_handlers` flag must not be included in deployments.

From this directory, build the web assets if needed, then validate the Worker without publishing:

```sh
npm --prefix web run build
npx wrangler deploy --dry-run --experimental-provision=false --config wrangler.staging.jsonc --outdir /tmp/recordly-share-staging-build
```

## Environment separation

Production should use separate resources. The local development endpoint now points to staging through ignored `.env.development.local`; packaged production configuration is unchanged. The desktop trusts only this exact staging origin alongside its existing origins. Payments remain a later step.

## Deployed hosted behavior

`HOSTED_MODE=true` selects the multi-account path. Staging opts into it; existing self-host configurations keep their current behavior. Hosted mode validates the bearer with Supabase, requires a confirmed email and a non-anonymous user, and ignores shared API secrets/dashboard cookies. Legacy comment account and shared-password dashboard routes are disabled in hosted mode.

Schema v4 / migration `0008_recording_owners.sql` adds nullable `videos.owner_id` and its index. Existing unowned rows remain inaccessible to hosted users; no ownership is guessed or backfilled. Runtime migration supports existing v3 databases. The remote staging database received migrations 0008 and 0009 through its console on 2026-09-23. Verified owner column = 1, upload tracking tables = 2, recordings = 0. These manual changes are not registered in Wrangler migration history. Do not blindly rerun the ALTER migration.

Recording creation binds the owner from the verified session, never the request body. One atomic conditional insert caps each owner at five stored rows, including pending and expired rows. Explicit owner deletion frees a slot. Library/view queries are scoped; all upload, metadata, renew, and delete routes check ownership before handling storage. Public share-link playback remains intentional.

Validation: all 83 local Worker tests passed, including all nine mutation routes against a different account, unowned-row isolation, five-slot concurrent reservations, slot release after deletion, and legacy migration/self-host regressions.

## Upload limits and cleanup

Hosted mode caps recordings at the owner-approved 1 GB (1,000,000,000 bytes), five stored rows per account, and thumbnails at 2 MiB. The limit is enforced on reservation and actual streamed bytes using FixedLengthStream. Direct uploads are capped at 50 MiB; multipart uses the desktop's fixed 25 MiB chunks with a bounded final chunk and an exact manifest. Transfers time out after five minutes. Completed objects are checked before publication and cannot be overwritten.

Schema v5 / `0009_upload_sessions.sql` adds `recording_uploads` and `recording_locks`. Multipart starts are idempotent, supplied upload IDs must match the stored session, and record mutations are serialized across isolates. Deletion aborts multipart sessions and removes R2 objects before freeing the slot; storage failures keep the row for retry. Metadata payloads and transcript/chapter counts are bounded, and retrying publication does not duplicate transcript rows.

Cleanup code removes unfinished reservations older than 24 hours and recordings whose 14-day free-plan expiry has elapsed, in batches of 100. It rechecks eligibility under the mutation lock and recovers crash locks older than one day. **The owner explicitly approved automatic staging cleanup. Deployed hourly at minute 17 UTC (`17 * * * *`), removing expired recordings and unfinished reservations older than 24 hours.** Verified in the R2 dashboard on 2026-09-23: the enabled Default Multipart Abort Rule aborts unfinished multipart uploads after seven days, across the bucket. This covers orphaned sessions left by a crash between R2 creation and D1 persistence. Public R2 access remains disabled and no custom domain is assigned. No lifecycle mutation was needed.

Hosted mode requires native Worker rate-limit bindings: 120 requests/minute per IP before auth/storage, and 60 requests/minute per verified account. These are permissive per-location abuse controls, not an exact global spend cap. The five-slot reservation remains atomic in D1. Staging namespaces are `2026092301` and `2026092302`; production must use distinct namespaces. References: [Cloudflare rate limits](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) and [FixedLengthStream](https://developers.cloudflare.com/workers/runtime-apis/streams/transformstream/).

## Desktop and verification

The share dialog now has a HeroUI recordings manager with pending-upload visibility and explicit delete confirmation. It calls authenticated main-process IPC, which validates trusted origins and forbids redirects. `VITE_CLOUD_SHARE_ENDPOINT` controls the endpoint; development falls back to localhost, while packaged builds fail clearly until configured. UI preview at `tests/ui/shared-recordings.html` uses disposable in-memory data only; expansion, confirmation, and deletion/slot count were checked in the browser.

A local backend is running at `127.0.0.1:8787` with isolated D1/R2 state under `/tmp/recordly-hosted-test-state` and the app's existing public Supabase configuration. Its generated config is ignored under `.wrangler/hosted-local.json`. No service-role key is used. Live unsigned health requests returned 401. The local server is no longer the development app endpoint. A fresh owner-approved magic-link request was followed by a signed-in native app session, and the real staging library loaded successfully as zero of five recordings. The owner-approved disposable native upload/playback/delete test subsequently passed.

Latest validation: 83 Worker tests, 12 auth/desktop contract tests, TypeScript checking, and staging deployment dry run passed. Deliberately truncated streams and injected storage failures emit expected runtime diagnostics in negative tests.

## Remaining external steps

1. Verify an authenticated feedback submission. Owner sign-in and native staging upload/playback/deletion are verified.
2. Free links expire after 14 days and hourly staging cleanup is deployed. Configure usage alerts before launch. The R2 bucket already aborts incomplete multipart uploads after seven days.
3. Plan separate production resources, verify another-account isolation live, and configure production builds before release. Payments remain last.

## Staging deployment verification (2026-09-23)

- Deployed with existing D1/R2 bindings, Supabase public auth settings, owner allowlist, and both native rate-limit bindings. No service-role key was supplied.
- Live unsigned `/api/health` and `/api/videos` return 401 with `Verified sign-in required`; an invalid bearer also returns 401. Legacy `/library` and `/auth/register` return 404. These checks exercise remote D1 schema initialization without creating recordings.
- The exact staging origin was added to the desktop allowlist. Six desktop contract tests passed, including rejection of a sibling workers.dev origin and a lookalike hostname. TypeScript checking passed.
- Fixed a development startup failure by explicitly prebundling React Aria's CommonJS `use-sync-external-store/shim` dependency. Verified the native HUD, project dashboard, and sign-in form render again.
- The user approved one fresh magic-link email to their existing owner account for the desktop callback test. Do not substitute a dashboard-generated link or extract session credentials.

The Home dashboard Shared tab now uses the real HeroUI recordings manager with refresh, quota usage, open-share controls, and explicit deletion confirmation. Verified visually in the signed-in native app: `0 of 5 recordings · 1 GB each`, `No shared recordings yet.` No existing project was uploaded.

## Native end-to-end test passed (2026-09-23)

The owner approved uploading a generated two-second 1920×1080 colour-pattern source and deleting its disposable cloud recording. Imported `/tmp/recordly-staging-test-20260923.mp4`, named the local project **Disposable staging test**, and published through the normal desktop share flow. The selected High export setting produced 1554×972 video with the editor's default 16:10 canvas; this was not a full-resolution 1080p output or a 1 GB stress test.

The public share page rendered the correct title and decoded all two seconds (`ended=true`, no video error). The signed-in library showed one of five slots and a 1.4 MB recording. Deleted only that approved disposable cloud recording through its confirmation UI. The library returned to zero of five, and reloading its public link showed **Recording unavailable**. The local synthetic project/source remain for repeat testing. No user recording was uploaded or deleted.

Still unverified live: large multipart uploads, 1 GB boundary under real network conditions, another-account rejection, feedback diagnostics/attachments, and packaged desktop protocol callbacks. Local boundary/concurrency/isolation tests are documented above. Free-plan links expire after 14 days. The next successful hourly cleanup removes stored objects and releases slots, in batches of 100; cleanup backlog or storage failures may delay this.

## Free-plan expiry policy (2026-09-23)

The owner selected 14 days. New hosted upload reservations get a server-assigned expiry 14 days from creation. All hosted accounts currently use the free policy; client-supplied plan/expiry claims are ignored. Paid entitlements are not wired yet. Free renewal is denied (403) to prevent indefinite extensions. The separate self-host mode keeps its existing 30-day setting. Desktop publishing and library copy disclose the free-plan expiry. Twenty-seven hosted/library tests passed, including expiry, renewal bypass prevention, expired playback denial, and self-host regressions.

The 14-day policy was deployed successfully to staging as version `2a38fbd4-a3c9-4028-a5ca-68a32b95a60a`.

## Publish UI and cleanup (2026-09-23)

The desktop toolbar now opens **Publish**, with HeroUI Link/Local choices. Link expands inline notes and Share using Motion (Framer Motion's `motion/react` package) and reduced-motion support. Local retains export settings and save flow. Share preparation no longer closes the popover; busy sharing disables destination switching and dismissal while preserving cancellation. Native UI inspection verified both modes and the complete notes/expiry disclosure layout.

Hourly cleanup was explicitly approved after automatic approval review required separate confirmation for permanent cloud deletion. Deployed version `81cf4abb-5703-4f4c-b74b-54ff428009d7`; Wrangler confirmed `17 * * * *`. The scheduled handler now reports failures to Cloudflare instead of swallowing them. Local scheduler tests verify expired bytes/rows are deleted while active recordings remain. 28 Worker tests and 15 export/feedback tests passed, plus TypeScript checking. A real scheduled run has not yet been observed.

The shared player now uses uploaded first-frame posters and falls back to the video’s decoded first frame when an older recording has no poster. Deployed to staging on 2026-09-23; Framer and custom domains are unchanged.
