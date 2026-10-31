# Desktop feedback

See [setup status](SETUP.md) for the applied project configuration, verification, and remaining launch work.

Before releasing feedback submission:

1. Apply `migrations/202609230001_feedback.sql` and then `migrations/202609230002_feedback_limits.sql` in the configured Supabase project. Apply `migrations/202610030001_feedback_access.sql` after both, including on existing deployments; it revokes inherited client table privileges while preserving owner reads and server inserts.
2. Deploy the `submit-feedback` Edge Function from the repository root with the Supabase CLI: `supabase functions deploy submit-feedback --workdir services --project-ref YOUR_PROJECT_REF`. The function explicitly validates the bearer token with `auth.getUser` before parsing or storing feedback. The function configuration disables only the gateway's JWT check, not the function's authentication.
3. Use the project's built-in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` secrets for the function. Never put a service-role key in the desktop app.

The desktop client calls the function with its existing signed-in session. Direct client report inserts and attachment uploads are disabled by the second migration. The function validates subject/message lengths, diagnostics bytes, and the actual uploaded files (five nonempty files, 10 MB total per submission), and caps the incoming request body. It reserves a per-account UTC daily quota atomically: 10 submission attempts, 25 files, and 50 MB. Failed attempts still consume quota, so repeated upload/delete/retry cycles do not reset it. No Storage schema triggers or modifications are required beyond the access policies.

Feedback is stored in `public.feedback_reports`. View reports through the Supabase dashboard and retrieve attachments from the private `feedback-attachments` bucket using each report's attachment paths. Owners can read their own reports; other users cannot. Staff use server-side service-role access. There is no email notification or public issue creation.

On submission, the modal captures up to 100 recent renderer warnings/errors (2,000 characters each), browser/platform details, and a timestamp. Common secrets, URLs, emails, and local home paths are redacted. Arbitrary log objects are not serialized. The final JSON is bounded to 290,000 UTF-8 bytes by dropping oldest entries, below the database's 300,000-byte limit. Diagnostics are automatically included; native-process logs are not collected. Attachments are chosen explicitly.

A local demo account can preview the form but cannot submit without a real Supabase session. Failed submissions retain the draft in memory; closing and reopening the same modal keeps it, but restarting the app does not. The function cleans up failed uploads on a best-effort basis. Periodically remove unattached objects left by interrupted sessions through the Storage API, and prune old `feedback_daily_usage` rows after their UTC day has ended.

Unit tests exercise the server handler with an injected storage/auth backend. `tests/feedback_limits.sql` verifies the migration's quotas and permissions in a disposable database with the migrations applied; it rolls back its test data. Live deployment and end-to-end Supabase uploads must be checked separately before release.

## Access verification

Run `checks/feedback-quota-access.sql` as postgres after all feedback migrations in a disposable Supabase database. It uses an existing user with no feedback usage today and rolls back test data. It checks server insertion, owner reads and cross-user isolation after hardening, server-only quota access, authenticated attachment-upload denial for the feedback bucket, client report write denial, anonymous read denial, and all three daily limits. The older `checks/feedback-access.sql` is only for testing migration 001 in isolation, before migration 002 removes direct client inserts.

Do not put real account IDs, project references, credentials, or operator setup status in this documentation.

## User-triggered export error reports (no account link)

Apply `202610020001_export_error_reports.sql` and deploy `submit-export-error` using `services/supabase/config.toml` (`verify_jwt = false`). The new function is public and accepts only the validated, 4 KiB technical-report schema; clients cannot insert/read reports directly. No change to manual account-linked feedback is required. Configure the existing public URL/publishable key in the desktop build. Never expose a service-role key.

The export error dialog has **Report error**, then a preview and explicit **Send report** action. Nothing is sent automatically or on opening the preview. The optional cloud-plan category is self-reported (`paid`, `not_paid`, or `unknown`); it is not an authenticated billing check. Current main does not expose a billing entitlement to this UI. The client uses `fetch` with no session Authorization, cookies or referrer. Reports store no account ID/email, media, path, logs, persistent device ID or IP. The function rejects Authorization headers and unknown payload fields. Supabase/infrastructure connection logs can still contain request metadata/IP; do not describe this as guaranteed anonymity.

View `public.export_error_reports` through staff/service-role access. Reports contain allowlisted error codes, numerical failure positions for both decoding attempts, format, stage, output dimensions/FPS, app version and OS, plus the optional cloud-plan category. Creation times are rounded to the hour. A database quota caps accepted anonymous submissions at 20 per minute globally without storing identity; this is an aggregate abuse/cost control, not per-user protection, and can be exhausted by other callers. No raw error text is persisted. Failed requests are retryable by the user.

The migration enables Supabase Cron and schedules daily deletion of reports older than 30 days and aggregate quota counters older than one day. Confirm the job exists and succeeds before releasing the client. Apply and validate this migration/function separately; no live backend deployment is performed by the code change. Update your collection/privacy notice with the real Supabase hosting country, infrastructure logging, recipients and retention. Explicit click-to-send and minimisation reduce risk but do not establish legal compliance for every jurisdiction.
