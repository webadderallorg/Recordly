# Supabase setup status

Verified 2026-09-23 in project `kgmqmaivltdolfzjrjjs` (Recordly).

Restored on 2026-10-08: `kgmqmaivltdolfzjrjjs.supabase.co` initially returned NXDOMAIN because the dashboard-confirmed Recordly project was paused. Resumed the existing project through Supabase Studio; it now reports Healthy. Verified HTTP 200 from Auth settings using the existing publishable key, HTTP 200 from a zero-row database read, and a PKCE Google authorization request redirecting to Google with HTTP 302. Email and Google are enabled; Azure and GitHub are disabled. The dialog now reads Auth settings and offers only enabled OAuth providers. The desktop loopback callback listener responds on port 43821. No real sign-in email was sent or new app session created in this verification; a fresh owner sign-in remains the final manual check. Local authentication tests use isolated mocked Supabase responses.

## Applied

Both `202609230001_feedback.sql` and `202609230002_feedback_limits.sql` were applied through the SQL editor, each inside a transaction. Do not rerun these create-only migrations against this project. They are not registered in Supabase CLI migration history.

- `feedback_reports` and `feedback_daily_usage` have row-level security enabled.
- Signed-in clients can read only their own reports and attachments. Direct report inserts and attachment uploads are blocked; clients cannot alter quotas or call the quota reservation function.
- `feedback-attachments` is private, with a 10,485,760-byte per-object limit.
- `submit-feedback` is deployed at `https://kgmqmaivltdolfzjrjjs.supabase.co/functions/v1/submit-feedback`. The deployed browser-editor files use the repository's `index.ts` and `handler.ts` logic, with formatting differences.
- The function verifies each bearer token through Supabase `auth.getUser` before processing the body. The legacy-secret gateway JWT check is off so modern user tokens can reach this verification. Server credentials stay in built-in function environment variables.
- Limits: five nonempty files and 10 MB total per submission; per account per UTC day, 10 attempts, 25 files, and 50 MB. Failed attempts consume reserved quota.

## Verification

- All 13 local feedback server, client, and diagnostics tests passed.
- Live SQL checks passed for owner isolation and anonymous denial before migration 002. Baseline script: `checks/feedback-access.sql` (only for migration 001, which allowed direct owner inserts).
- After migration 002, live checks passed for server-only quota access, blocked direct-upload policies, per-report bounds, and all three daily quotas. Script: `checks/feedback-quota-access.sql`. All test data was rolled back; no auth users were created.
- Live HTTP POSTs with no token and a deliberately invalid token both returned `401` with `SIGN_IN_REQUIRED` from the deployed function.
- A successful signed-in desktop submission with a real file has not yet been tested. Storage upload and report insertion end to end remain a release check.

Existing `wallpapers`, `user_limits`, `users`, `favorites`, and `moderation_queue` tables were preserved. All five already had RLS enabled. No custom triggers on `auth.users` were found. Existing user data was not changed.

## Authentication observations

- Email sign-in and Google are enabled. Microsoft/Azure and SAML are disabled.
- New signups and email confirmation are enabled. Anonymous sign-ins and manual identity linking are disabled.
- Redirect allowlist: `recordly://auth/callback`, `recordly-dev://auth/callback`, `http://127.0.0.1:43821/auth/callback`.
- Default site URL remains `http://localhost:3000`; choose the intended production fallback before launch.
- Resend SMTP is connected and confirmed enabled after reload. `auth.recordly.dev` is verified; the sender is `Recordly <noreply@auth.recordly.dev>`. The key has sending-only access restricted to this domain and is stored only in Supabase SMTP. An owner-authorized magic-link email was sent through Supabase and reported Delivered by Resend. See `EMAIL_SETUP.md`.
- CAPTCHA and leaked-password protection are disabled. Enabling CAPTCHA also requires client integration; do not toggle it without implementing the client flow.

The local desktop app already referenced this Supabase project before setup. Its current feedback client calls the deployed `submit-feedback` function. No landing page was connected and no desktop release was published.

## Remaining launch work

1. SMTP delivery has passed an owner-authorized magic-link test. Review rate limits for launch volume; successful inbox delivery does not complete the desktop callback/recovery tests.
2. Test app-initiated email signup/sign-in and Google login end to end. The local UI uses magic links for both signup and sign-in. Verify Azure and GitHub provider configuration before enabling those sign-in options for release. Email templates are saved live; the app changes are not released.
3. Decide the production fallback URL. The UI requires a Supabase session and offers Google, Microsoft, GitHub, and email magic links. There is no local demo or guest login.
4. Verify a real desktop feedback submission. Add cleanup for interrupted uploads and old quota rows through the appropriate server-side APIs.
5. Cloud recording ownership, five-slot quotas, byte limits, cleanup code, and management UI are implemented locally; the private staging schema is migrated. Complete real-account and protected staging tests before deployment. See `../recordly-share/worker/STAGING.md`.
6. Configure payments after these foundations and the planned frontend changes.

Only three approved email DNS records under `auth.recordly.dev` were added. Framer hosting, root/www DNS, marketplace, media, Google provider credentials, and payment settings are unchanged. Cloudflare's recording Worker remains undeployed.
