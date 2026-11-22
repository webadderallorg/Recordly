# Recordly cloud sharing

Recordly's **Publish** menu can save the current edit as a local file or create a shared link. The account menu opens sign-in. For **Create share link**, one progress bar in the Publish menu tracks both export and upload. When the link is ready, the same menu shows the preview and **Copy link**. Sharing renders an MP4 to a temporary file, uploads it to Recordly Share, and finalizes its metadata. The temporary file stays until the share controller unmounts, then Recordly removes it.

While rendering for either destination, the loader shuffles its lines, about 80% sensible and 20% playful.

Set `VITE_CLOUD_SHARE_ENDPOINT` in `.env` before building. Development falls
back to `http://localhost:8787/api/upload` when the setting is unset. Packaged
builds require an explicit endpoint to enable cloud sharing.

`npm run env:pull` fills in public sign-in settings and copies the repository's
Cloud endpoint into `.env` when that setting is missing or blank. Recordly's
GitHub variable points to `https://videos.recordly.dev/api/upload`. Local builds
using the pulled endpoint publish to the production Recordly Cloud service.

To publish to a local Worker, set
`VITE_CLOUD_SHARE_ENDPOINT=http://localhost:8787/api/upload` in `.env`.
`npm run env:pull` preserves that configured endpoint. Before starting Vite, unset
`VITE_CLOUD_SHARE_ENDPOINT` in your shell and remove any conflicting value from
`.env.local` or a mode-specific file such as `.env.development.local`. Those
settings take precedence over `.env`.

Production releases use the same Recordly Cloud endpoint. The service must be
deployed and verified before release. Publishing requires the user's Recordly
access token. No share API secret is exposed in the app. Hosted deployment and
subscription operations are maintained with the separate private service.

Under **Account settings → Plan & billing**, **Manage subscription** opens Stripe when the
billing portal is available. If a Cloud account has no portal, as can happen with
complimentary access, the same button explains that no portal is available and links
to Recordly support by email. Plan details update automatically when Recordly regains
focus.

## Publishing protocol

1. `POST /api/upload` creates a recording and share code.
2. Small files use `PUT /api/upload-data/:shareCode`; files over 50 MB use multipart uploads in retryable 25 MB chunks.
3. `POST /api/metadata/:shareCode` publishes the title and creator notes.
4. The returned `/s/:shareCode` URL opens the complete viewing and feedback page.

The service provides R2 video storage, D1 metadata, range streaming, a responsive viewing page, timestamped comments, reactions, captions, password protection, expiry, and a private video library. See [the service README](../services/recordly-share/worker/README.md) for local and deployment instructions.

## Comments

Anyone with a valid link can watch a public recording. Leaving timestamped comments requires a signed-in account; Recordly Cloud uses the viewer’s verified Recordly account and profile name. The server derives comment authorship from the session, and viewers can edit or delete their own comments. Account and IP rate limits and the 2,000-character comment limit apply. The self-hosted worker requires a separate, signed-in account local to that instance; a supplied display name alone does not authorize a comment.

## Third-party licensing

The hosting service is based on MIT-licensed open-source software. Required attribution and the complete license text are preserved in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) and [the vendored license](../services/recordly-share/LICENSE).

The self-hosted worker is a single-owner library. Set `OWNER_USER_ID` to the owner’s Supabase user ID. Other accounts in the same Supabase project cannot administer the library. Missing owner configuration disables Supabase bearer access.
