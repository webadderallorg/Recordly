# Recordly cloud sharing

Recordly's **Export** menu offers downloading the current edit or **Create share link**. The Account button at the bottom of the left toolbar opens sign-in. Sharing renders an MP4 to a temporary file, uploads it to Recordly Share, finalizes its metadata, and removes the temporary file when the dialog closes.

The desktop app defaults to the local development endpoint:

```text
http://localhost:8787/api/upload
```

The endpoint is intentionally not user-configurable. All builds currently use the local service above. Production service integration is planned but is not selected by any build. Publishing requires the user's Recordly access token. No share API secret is exposed in the app.

## Publishing protocol

1. `POST /api/upload` creates a recording and share code.
2. Small files use `PUT /api/upload-data/:shareCode`; files over 50 MB use multipart uploads in retryable 25 MB chunks.
3. `POST /api/metadata/:shareCode` publishes the title and creator notes.
4. The returned `/s/:shareCode` URL opens the complete viewing and feedback page.

The service provides R2 video storage, D1 metadata, range streaming, a responsive viewing page, timestamped comments, reactions, captions, password protection, expiry, and a private video library. See [the service README](../services/recordly-share/worker/README.md) for local and deployment instructions.

## Comments

Anyone with a valid link can watch a public recording and leave timestamped feedback using a display name. No account or sign-in is required. The existing per-IP rate limit and 2,000-character comment limit still apply.

## Third-party licensing

The hosting service is based on MIT-licensed open-source software. Required attribution and the complete license text are preserved in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) and [the vendored license](../services/recordly-share/LICENSE).

The self-hosted worker is a single-owner library. Set `OWNER_USER_ID` to the owner’s Supabase user ID. Other accounts in the same Supabase project cannot administer the library. Missing owner configuration disables Supabase bearer access.
