# Recordly authentication setup

Recordly requires a non-anonymous Supabase Auth session before onboarding can advance to permissions or recording can start. The sign-in dialog uses email magic links and whichever of Google, Microsoft, or GitHub OAuth are enabled in the configured project; there is no guest or local demo login. Sessions persist across app restarts. The desktop application uses PKCE and returns from the system browser through a loopback callback in development and `recordly://auth/callback` in production. The dialog reads `/auth/v1/settings` and shows only enabled OAuth providers. SAML is intentionally hidden until configured.

## Account and permission settings

**Settings → Account** is available in both the editor and Projects dashboard. Display-name changes update Supabase user metadata and refresh the account avatar everywhere. Email changes use Supabase's email confirmation flow and the same desktop PKCE callback as sign-in; the existing email stays active until confirmation completes. Pending email changes are shown after reopening Settings. Connected sign-in methods reflect the user's actual account identities. Sign out clears the local session, revokes refresh sessions on all devices, and brings back mandatory sign-in; local projects remain on disk.

**Settings → Permissions** shows live macOS Screen Recording and Accessibility statuses, refreshes when the app regains focus, and links to the onboarding permission setup. Microphone and camera permission requests remain tied to enabling those devices for recording. On other platforms, capture selection remains part of starting a recording.

## 1. Create the project

1. Create a Supabase project.
2. In **Project settings → API**, copy the project URL and publishable key.
3. Copy `.env.example` to `.env.local` and fill in both values. Never use the service-role key in the desktop application.
4. In **Authentication → URL configuration**, add `recordly://auth/callback` and `http://127.0.0.1:43821/auth/callback` to the redirect allow list.

Enable email authentication and allow new sign-ups for magic links. Request the email from Recordly, then open it on the same computer with Recordly running. Configure production SMTP as described in `services/supabase/EMAIL_SETUP.md`.

## 2. Google

1. Create a Web OAuth client in Google Auth Platform.
2. Add Supabase's callback URL, `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`, as an authorized redirect URI.
3. Enable Google under **Supabase → Authentication → Sign In / Providers** and paste the Google client ID and secret.
4. Keep the requested scopes to `openid`, email, and profile unless Recordly genuinely needs more.

## 3. Microsoft and GitHub

Enable Azure and GitHub under **Authentication → Sign In / Providers**, supply their client credentials, and use `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback` as the provider callback. Microsoft sign-in requests the `email` scope.

## 4. SAML SSO (currently hidden)

SAML is configured per customer workspace. Supabase's SAML support requires Pro or above.

1. Enable SAML in the Supabase Auth provider settings.
2. Obtain the customer's IdP metadata URL or metadata XML file.
3. Register the connection and its email domain with the Supabase CLI, for example:

   ```sh
   supabase sso add --type saml --project-ref YOUR_PROJECT_REF \
     --metadata-url 'https://customer.example/idp/metadata' \
     --domains customer.example
   ```

The auth helper supports extracting a work email domain for SAML; this option is currently hidden in the modal.

## 5. Verify locally

Restart `npm run dev` after creating `.env.local`. Open an editor and verify:

1. Without a session, **Welcome to Recordly** opens and cannot be skipped or dismissed.
2. Request an email magic link. Sending the email alone must not grant access. Opening the link exchanges its PKCE code for a persistent Supabase session and advances to **Permissions**.
3. OAuth opens the system browser and returns to Recordly through the same callback.
4. On Permissions, **Start recording** opens the recording controls after required system permissions are granted.
5. Restart the app to verify session restoration. Sign out from the account dialog and verify that mandatory sign-in returns.
6. **Show onboarding** opens Permissions directly for signed-in users. The recording HUD also checks for a Supabase session before preparing a recording.

Automated UI tests use an isolated Supabase URL and mocked Auth HTTP responses; no production auth bypass is enabled in development or tests.

Add the same `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` values to the share Worker's secrets or variables. Set `OWNER_USER_ID` to the owner’s Supabase user ID. The Worker validates the access token with Supabase and requires that owner identity before accepting API requests. `API_SECRET` is server-side only and remains available for library administration and explicitly enabled local integration tests; it is never entered into or exposed by the desktop app.
