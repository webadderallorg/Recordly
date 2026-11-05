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

## Six-digit code flow (2026-10-24)

Email sign-in now uses **Email me a code**, followed by six-digit verification.
The desktop and hosted web share the same code-entry and optional password-login
controls. Users can open their inbox on a different device; verification uses
Supabase `verifyOtp` with `type: "email"`. The form supports a 60-second resend
cooldown, changing the target email and retrying expired codes. The provider's
rate limits remain authoritative.

Both saved live templates now display `{{ .Token }}` prominently. The magic-link
subject is **Your sign-in code for Recordly**; signup confirmation is **Your
verification code for Recordly**. A small `{{ .ConfirmationURL }}` fallback remains
for older desktop versions that require a callback link. The six-digit OTP length
was saved and verified after explicit owner confirmation. The existing 3,600-second
expiry and email rate limits were preserved. A fresh delivered six-digit code was
successfully verified in a separate client, and its account session authenticated
to the production cloud library. That temporary session was signed out locally.

Passwords are optional after email verification. The local desktop Account settings
and hosted library Settings provide the same password form, requiring at least
12 characters and matching confirmation. Existing password login remains
available as a secondary sign-in method. Forgotten passwords can be replaced
after signing in with an email code. Password updates use the authenticated
Supabase user API; no password is saved in client persistent storage or logs.
No real account password was changed during testing.

The email templates and OTP length are live. These desktop/web UI changes remain
local until separately released/deployed; the installed app and deployed web UI
were not replaced by this task. Existing callback handling remains compatible
with older links.


## Published email design (2026-10-27)

All 13 Supabase authentication/security templates use the same full-width artwork
banner, inline Recordly mark, DM Sans font with system fallbacks, flat layout and
message-specific copy. The banner starts at the email's top-left edge with no
outside padding or rounded container. Text below it has mobile-friendly spacing.
Codes remain selectable text; links remain the provider's templated confirmation
URLs. Sign-in and signup emails use six-digit codes without an extra code label.

`templates/catalog.json` lists every template, subject, message and action. It is
the source for `npm run email:build` (`scripts/build-auth-emails.mjs`). Generated
HTML files are stored alongside the catalog. Edit the catalog to change shared
copy, or the generator to change the common layout, then rebuild. Building locally
does not publish template changes to Supabase.

The six authentication templates cover sign-in, signup confirmation, invitation,
email-change confirmation, password reset and reauthentication. Seven additional
security templates cover password/email/phone changes, sign-in methods being
linked/unlinked, and MFA methods being added/removed. Their content is saved in
Supabase, while all seven optional notification switches remain disabled as they
were before the redesign. Creating designs does not activate new notification
flows. SMTP, code expiry/length, limits, auth redirect configuration and passwords
were not changed.

Public decorative artwork, the logo and font are hosted in the dedicated
`email-assets` Storage bucket. The existing private attachment bucket is separate.
The asset bucket has a 1 MB per-object limit and no public write policy. The banner
and logo sources are in `templates/assets/`; DM Sans and its OFL license remain in
`src/assets/fonts/dm-sans/`. Both light/dark banner variants are provided. Clients
without dark media queries use the light design; clients without web fonts use
the system/Arial fallback. Images carry no essential authentication information.

Validation: all 13 saved provider templates were verified against local source
through a fresh dashboard tab, including message copy and authentication
placeholders. Subjects were checked in the provider editor.
Public asset bytes matched local files. Fifty-two browser renders cover 320/375/
640-pixel widths and light/dark appearances, including full-width artwork, font
loading and no horizontal overflow. These checks do not certify rendering in every
email client. No new authentication email was sent during this publication.

## Local live design preview

Run `npm run email:preview` from the shared checkout and open
`http://127.0.0.1:3500/`. It runs separately from Electron and previews the same HTML
saved in Supabase. The email menu includes all 13 messages. Appearance and width
controls preview light/dark and desktop/mobile layouts with sample data.

Use **Edit copy** for immediate heading/message edits or edit the raw HTML. Drafts
are retained separately for each message in the browser. **Reset this draft**
returns to the generated source. Browser edits stay local; they neither update
Supabase nor send email.

Stripe payment/refund receipts, invoices and payment notices are Stripe-managed,
separate from these templates. Their logo/colors can be adjusted in Stripe's
branding settings; changing this catalog does not change Stripe emails.

The preview also includes 14 new subscription/billing designs from
`../email/billing/catalog.json`. They share the account email renderer and have
explicit plain-text alternatives, but are not connected to billing delivery.
See `../email/README.md` for the message inventory and delivery requirements.
The Rendering menu now simulates blocked images/fonts, stripped formatting and
plain text. Generated auth `.txt` files are references; the received auth email's
actual MIME alternative still needs inspection.

On 28 October 2026, all 13 saved account templates received concise, message-specific
inbox preview text. Invitation and password-reset copy is warmer; code instructions,
security warnings and provider variables remain intact. The updated content was
verified against source after provider navigation/reload. Notification activation
and SMTP sender settings were not changed.
