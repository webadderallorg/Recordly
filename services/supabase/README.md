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

## User-triggered error reports

Apply `202610020001_export_error_reports.sql` and then `20261023120000_app_error_report_logs.sql` before deploying the updated `submit-export-error` function using `services/supabase/config.toml` (`verify_jwt = false`). The existing endpoint accepts legacy export summaries and version 2 application reports. The latter contain the failure, a fixed context category, format, and a diagnostic snapshot bounded to 290,000 UTF-8 bytes. Request and stored JSON limits are 1,000,000 bytes to allow for nested JSON escaping. Clients cannot insert or read reports directly. Configure the existing public URL/publishable key in the desktop build; never expose a service-role key.

**Report error** sends immediately, without a second confirmation or sign-in. Nothing is sent merely because an error occurs. Each button shows sending, confirmed success, or a retryable failure, and prevents repeated clicks while sending. Error notifications remain available until dismissed and keep their existing retry/copy action alongside reporting. Application error pages use the same reporting component as export errors.

Reports include recent renderer warnings/errors, browser/platform metadata, persisted export diagnostics when available, and the displayed failure. Common secrets, emails, URLs, home paths, external-drive paths and temporary paths are redacted before sending; arbitrary console objects are not serialized. Recordings and attachments are not included. Native-process console logs are not collected. The client sends no session Authorization, cookies or referrer, and the function rejects Authorization headers and unexpected report fields. Supabase infrastructure can retain connection metadata separately.

View `public.export_error_reports` through staff/service-role access. Version 1 reports retain their allowlisted export codes and optional self-reported cloud-plan category. Version 2 reports contain redacted error text and logs and use `unknown` for the cloud plan. Creation times are rounded to the hour. The existing quota caps accepted submissions at 20 per minute globally; it can be exhausted by other callers. The existing daily Cron job removes reports after 30 days and quota counters after one day.

Deploy the database migration before the function and desktop client. Run `tests/export_error_reports.sql` in a disposable migrated database to check privileges, storage limits, quota and retention. Handler tests inject the storage backend; browser tests intercept the network request and verify actual log content, retry and confirmed success. These checks do not establish that the live service has been deployed.
