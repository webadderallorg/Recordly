# Recordly Share

Recordly Share is the self-hosted video publishing and review service used by Recordly. It runs as a Cloudflare Worker with R2 video storage, D1 metadata, range streaming, a responsive viewer, timestamped comments, reactions, passwords, expiration, and a private recording library.

## Local development

```sh
cp .dev.vars.example .dev.vars
npm ci
npm --prefix web ci
npm --prefix web run build
npm test
```

This non-publishing path builds draft viewer pages and runs the Worker locally
through its test harness, including API and database checks. It does not require
legal approval. For interactive viewer work, run `npm --prefix web run dev`.

Starting the interactive Worker with `npm run dev` uses the same guarded build
hook as deployment. Before using that command, copy `web/.env.legal.example` to
`web/.env.production.local` and complete the operator review described below.
Do not mark unreviewed details as approved just to start local development.

Set `OWNER_USER_ID` to the deployment owner’s Supabase user ID. Only that user may administer this single-owner library. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in `.dev.vars` to the same public project configuration used by the desktop app. Recordly sends the signed-in user's access token when it publishes to:

- Endpoint: `http://localhost:8787/api/upload`

The Worker validates Supabase access tokens before accepting uploads. `API_SECRET` remains a server-side library-administration password. An API-secret upload fallback can be enabled only for isolated local tests by setting `ALLOW_API_SECRET_UPLOADS=true`; do not enable it in production.

Anyone with a valid link can watch and read comments, subject to the recording password and availability. Posting comments requires a signed-in account on this self-hosted instance; these accounts are separate from Recordly Cloud. Authors can edit their own comment text and delete their own comments. Turning off feedback prevents new comments and edits while still allowing authors to delete their comments. Account, IP and recording rate limits and comment-length limits remain enabled.

## Deployment

```sh
npm ci
npx wrangler secret put API_SECRET
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
npm run deploy
```

Before deploying, copy `web/.env.legal.example` to `web/.env.production.local`
and supply the operator-reviewed support address, processing locations, effective
date and explicit legal approval. The local file stays out of Git. A deployment
provider can supply the same `PUBLIC_LEGAL_*` values in its build environment.
Do not set the approval value until those details have been reviewed.

`wrangler.jsonc` runs `npm run build:web` before bundling, including direct
`npx wrangler deploy` and Deploy-to-Cloudflare builds. That command installs the
viewer dependencies from `web/package-lock.json` and runs its guarded
`build:release`. A missing configuration or failed viewer build stops deployment
instead of serving an older checked-in viewer. `npm run dev` uses the same Worker
build hook. For UI development without publication, use `npm --prefix web run dev`
after installing the web dependencies.

`web/dist` is generated locally and stays out of version control. CI installs the
viewer dependencies, runs its unit tests and Astro checks, then builds the viewer
before Worker tests exercise asset routes. An ordinary validation build does not
approve publication details or deploy. Deployment always runs the legal release
guard again. Keep source, migration and viewer changes together.

Set `SUPABASE_URL` as a Worker variable. The ID-less configuration provisions
`recordly-share-db` and `recordly-videos` for a new self-hosted deployment.
This directory contains only the single-owner, self-hosted service. Recordly’s
managed cloud service and subscription backend are maintained separately. Do not
set `HOSTED_MODE=true` here: hosted configurations are rejected before database
access, including scheduled cleanup. The desktop’s authenticated cloud API client
continues to use the managed endpoint; it does not bundle the subscription backend.

Existing self-hosted databases are upgraded automatically at runtime. Schema version
numbers and migration filenames retain historical gaps for compatibility; hosted-only
subscription migrations are maintained with the private service. Do not apply this
self-hosted service to an existing managed cloud database.

## Attribution

This service is adapted from an MIT-licensed open-source project. The required original copyright and permission notice is preserved in [`../LICENSE`](../LICENSE) and Recordly's root `THIRD_PARTY_NOTICES.md`. Product-facing pages use Recordly branding; legal attribution must remain with distributed copies.

## Worker source layout

`src/index.js` contains the fetch/scheduled entry points and error boundaries. `router.js` dispatches requests and applies route access checks. The implementation lives in focused modules:

- `schema.js`: database bootstrap and migrations.
- `auth.js` and `accounts.js`: owner/dashboard access, video passwords, and instance-local viewer accounts.
- `uploads.js`: upload creation, multipart transfers, and metadata.
- `media.js`: streaming, captions, share data, and social previews.
- `feedback.js`: comments and reactions.
- `library.js`: listing, renewal, deletion, view counts, and expiry cleanup.
- `crypto.js`, `http.js`, `requestBody.js`, and `video.js`: shared cryptographic, bounded request parsing, response, and video metadata helpers.
- `moderation.js` and `recordingLock.js`: public reports and serialized recording controls.

After a viewer build, run `npm test` here to exercise these modules through the
Worker endpoints and database migrations. For a fresh source checkout, the
non-publishing validation sequence is:

```sh
npm ci
npm --prefix web ci
npm --prefix web test
npm --prefix web run check
npm --prefix web run build
npm test
```

The web build resolves shared desktop authentication components against its own
React, HeroUI and icon dependencies; a root Electron dependency installation is
not required.

## Recovering a recording moderation lock

A stopped Worker invocation or a failed lock cleanup can leave a row in
`recording_locks`. The service deliberately keeps that recording busy. The row's
`created_at` does not prove that its action has stopped, so it must not be expired
or removed automatically based on age.

Recovery requires an operator with direct access to the deployment's D1 database:

1. Stop new invocations that can mutate that database, including public requests,
   service bindings and scheduled work. Confirm that previous invocations and
   their database operations have ended. If quiescence cannot be established,
   keep the lock and investigate with the hosting provider.
2. While the service remains quiescent, inspect the exact recording's lock:

   ```sql
   SELECT share_code, token, created_at FROM recording_locks
   WHERE share_code = '<recording-code>';
   ```

3. Remove only the observed lock, matching both its recording code and token:

   ```sql
   DELETE FROM recording_locks
   WHERE share_code = '<recording-code>' AND token = '<observed-lock-token>'
   RETURNING share_code, token, created_at;
   ```

   Preserve the returned row in the maintenance record. Zero returned rows means
   that this lock was already removed or changed; inspect again rather than
   deleting a different token or clearing the table.
4. Resume service after maintenance is complete and retry the owner's operation.

The SQL can be run with `wrangler d1 execute` using the explicit deployment
configuration, database and `--local` or `--remote` selection. This is a manual
maintenance procedure; changing a token or checking a confirmation box does not
establish that an earlier Worker action has ended.
