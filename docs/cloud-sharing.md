# Recordly cloud sharing

Recordly's **Publish** menu can save the current edit as a local file or create a shared link. The account menu opens sign-in. Sharing renders an MP4 to a temporary file, uploads it to Recordly Share, finalizes its metadata, and removes the temporary file when the dialog closes.

Development defaults to the local endpoint when `VITE_CLOUD_SHARE_ENDPOINT` is unset:

```text
http://localhost:8787/api/upload
```

The endpoint is intentionally not user-configurable. Packaged builds require an
explicit `VITE_CLOUD_SHARE_ENDPOINT`; without it, cloud sharing is unavailable.
Production releases target `https://videos.recordly.dev/api/upload`. The production
service must be deployed and verified before release. Publishing requires the
user's Recordly access token. No share API secret is exposed in the app. Hosted deployment and subscription
operations are maintained with the separate private service.

## Publishing protocol

1. `POST /api/upload` creates a recording and share code.
2. Small files use `PUT /api/upload-data/:shareCode`; files over 50 MB use multipart uploads in retryable 25 MB chunks.
3. `POST /api/metadata/:shareCode` publishes the title and creator notes.
4. The returned `/s/:shareCode` URL opens the complete viewing and feedback page.

The service provides R2 video storage, D1 metadata, range streaming, a responsive viewing page, timestamped comments, reactions, captions, password protection, expiry, and a private video library. See [the service README](../services/recordly-share/worker/README.md) for local and deployment instructions.

## Comments

Anyone with a valid link can watch a public recording. Leaving timestamped feedback requires a signed-in account; Recordly Cloud uses the viewer’s verified Recordly account and profile name. The server derives comment authorship from the session, and viewers can edit or delete their own comments. Account and IP rate limits and the 2,000-character comment limit apply. The self-hosted worker requires a separate, signed-in account local to that instance; a supplied display name alone does not authorize a comment.

## Third-party licensing

The hosting service is based on MIT-licensed open-source software. Required attribution and the complete license text are preserved in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) and [the vendored license](../services/recordly-share/LICENSE).

The self-hosted worker is a single-owner library. Set `OWNER_USER_ID` to the owner’s Supabase user ID. Other accounts in the same Supabase project cannot administer the library. Missing owner configuration disables Supabase bearer access.
