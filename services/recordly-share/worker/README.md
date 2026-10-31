# Recordly Share

Recordly Share is the self-hosted video publishing and review service used by Recordly. It runs as a Cloudflare Worker with R2 video storage, D1 metadata, range streaming, a responsive viewer, timestamped comments, reactions, passwords, expiration, and a private recording library.

## Local development

```sh
cp .dev.vars.example .dev.vars
npm install
npm --prefix web install
npm --prefix web run build
npm run dev
```

Set `OWNER_USER_ID` to the deployment owner’s Supabase user ID. Only that user may administer this single-owner library. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in `.dev.vars` to the same public project configuration used by the desktop app. Recordly sends the signed-in user's access token when it publishes to:

- Endpoint: `http://localhost:8787/api/upload`

The Worker validates Supabase access tokens before accepting uploads. `API_SECRET` remains a server-side library-administration password. An API-secret upload fallback can be enabled only for isolated local tests by setting `ALLOW_API_SECRET_UPLOADS=true`; do not enable it in production.

Anyone with a valid link can watch and leave timestamped feedback using a display name; commenting does not require an account. Per-IP rate limiting and comment-length limits remain enabled.

## Deployment

```sh
npm install
npm --prefix web install
npm --prefix web run build
npx wrangler secret put API_SECRET
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
npm run deploy
```

Set `SUPABASE_URL` as a Worker variable. The ID-less configuration provisions `recordly-share-db` and `recordly-videos` for a new deployment. Desktop builds currently upload only to localhost; production service integration is deferred.

## Attribution

This service is adapted from an MIT-licensed open-source project. The required original copyright and permission notice is preserved in [`../LICENSE`](../LICENSE) and Recordly's root `THIRD_PARTY_NOTICES.md`. Product-facing pages use Recordly branding; legal attribution must remain with distributed copies.

## Worker source layout

`src/index.js` contains the fetch/scheduled entry points and error boundaries. `router.js` dispatches requests and applies route access checks. The implementation lives in focused modules:

- `schema.js`: database bootstrap and migrations.
- `auth.js` and `accounts.js`: owner/dashboard access, video passwords, and optional viewer accounts.
- `uploads.js`: upload creation, multipart transfers, and metadata.
- `media.js`: streaming, captions, share data, and social previews.
- `feedback.js`: comments and reactions.
- `library.js`: listing, renewal, deletion, view counts, and expiry cleanup.
- `crypto.js`, `http.js`, and `video.js`: shared cryptographic, response, and video metadata helpers.

Run `npm test` here to exercise these modules through the Worker endpoints and database migrations.
