# Authentication email setup

Completed provider connection on 2026-09-23. Resend marks the domain Verified. Supabase custom SMTP was saved and confirmed enabled after reloading the dashboard. Delivery test passed: Supabase sent one authorized magic-link email to the owner, and Resend reported Delivered. This verifies SMTP delivery, not completion of the desktop authentication callback.

- Provider: Resend.
- Sending domain: `auth.recordly.dev` (verified by Resend).
- Configured sender: `Recordly <noreply@auth.recordly.dev>`.
- SMTP: `smtp.resend.com`, TLS port `465`, username `resend`.
- Credential: a sending-only Resend API key restricted to this sending domain, stored only in Supabase SMTP. Created as `Recordly Supabase Auth SMTP`, with Sending access restricted to `auth.recordly.dev`. The secret is not stored in this repository.

Resend's required DNS records (names relative to `recordly.dev`):

| Type | Name | Value | Proxy |
| --- | --- | --- | --- |
| TXT | `resend._domainkey.auth` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCzbtnuzzRFKTpkxRjKRWPA7QC6lBekq9BXBddPA6CSlXxfdS1aDFqHWZvawSzp4ZmZ4qtzRA8s4tqtRHxmgwBYiI21/OWKY96UcMqrU9o7nWpqfdMsrl4SXB/4/c+eBo3+hdg7DPnPIB/98EB3bPojIXba+PLDbY8URVCopuNHLQIDAQAB` | N/A |
| CNAME | `rsend.auth` | `rsend-apne1.forge.rmta.net` | DNS only |
| CNAME | `send.auth` | `send.forge.rmta.net` | DNS only |

The DKIM value is a public verification key, not a private credential. Use automatic TTLs. Receiving is disabled. Do not add the optional root DMARC record as part of this setup.

Verified these names were unused before adding them in Cloudflare DNS. Existing root A records, `www` -> `sites.framer.app`, `marketplace`, and `media` remain untouched. This configuration does not host the website on Cloudflare or reroute incoming email.

Supabase settings: custom SMTP enabled, port 465, minimum per-user interval 60 seconds. The dashboard states that enabling custom SMTP sets the email rate limit to 30/hour; higher launch volume requires reviewing both providers' limits. Sender, name, host, and enabled state persisted after reload. One owner-authorized authentication email was sent and marked Delivered by Resend (subject: Your Magic Link). No password was changed. Full signup/recovery completion also depends on the desktop flows.

Reference: https://resend.com/docs/send-with-supabase-smtp

## Magic-link follow-up

The dashboard-issued delivery test fell back to `http://localhost:3000`. It did not originate from the desktop's PKCE client, so it cannot verify desktop login. The fallback remains unchanged pending the intended production destination.

The local sign-in dialog now offers **Email me a sign-in link** for new and existing accounts. Signup uses the same inbox-verification flow; the production UI no longer offers password reset or the unconfigured Microsoft provider. It uses the existing PKCE client and explicitly requests `http://127.0.0.1:43821/auth/callback` in development or `recordly://auth/callback` in packaged builds. Request and open the link on the same computer with Recordly running. Six auth unit tests and TypeScript checking passed; a fresh email from the updated app and successful session exchange remain unverified. No desktop release was published.

The live magic-link email was restyled and verified after dashboard reload on 2026-09-23. Subject: **Your sign-in link for Recordly**. Source: `templates/magic-link.html`; it preserves Supabase's `{{ .ConfirmationURL }}`. The signup confirmation template was also updated to `templates/confirm-sign-up.html`, subject **Verify your email for Recordly**. The recovery template was not changed.

## Desktop verification (2026-09-23)

After the owner approved a fresh magic link, it was requested through the native Recordly sign-in form. The app subsequently displayed the real owner account, and its authenticated request to the deployed staging library succeeded with zero recordings. This verifies a working desktop session and backend token validation; packaged `recordly://` callbacks still need a release-build test.
