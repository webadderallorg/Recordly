# Recordly authentication setup

Packaged Recordly requires a non-anonymous Supabase Auth session before onboarding can advance to permissions or recording can start. In development, automatic first-run onboarding and settings previews are optional: Continue, Skip, and page navigation work without signing in, while real operating-system permissions are still required to start recording. Preview displays a restored account without replacing or hiding its session. Closing or skipping the development tour persists its dismissal so a newly recorded video can open its editor without replaying onboarding. Preview does not mark onboarding complete or create a signed-in session. Native permission recovery and the explicit `onboardingPreview=0` route use the real account-required flow, including permission progress after a restart. The sign-in dialog uses email magic links and whichever of Google, Microsoft, or Apple OAuth are enabled in the configured project; there is no guest or local demo login. Sessions persist across app restarts. The desktop application uses PKCE and returns from the system browser through a loopback callback in development and `recordly://auth/callback` in production. The dialog reads `/auth/v1/settings` and keeps all three OAuth buttons visible and disables providers that are not enabled. SAML is intentionally hidden until configured.

Full onboarding plays the welcome music on every opening in both development and packaged builds, including the inline fallback. Previous playback and completion flags do not silence it. The mute control applies to the current opening; blocked autoplay retries on interaction, and closing onboarding or starting a recording stops the music. Dedicated permission recovery stays separate from the full welcome experience: it shares the full-window artwork and outer footer, with 44px permission actions and recording button, but has no account steps, page navigation, or welcome music.

## Account and permission settings

**Settings → Account** is available in both the editor and Projects dashboard. Display-name changes update Supabase user metadata and refresh the account avatar everywhere. Email changes use Supabase's email confirmation flow and the same desktop PKCE callback as sign-in; the existing email stays active until confirmation completes. Pending email changes are shown after reopening Settings. Connected sign-in methods reflect the user's actual account identities. Sign out clears the local session and revokes refresh sessions on all devices; local projects remain on disk. Packaged builds bring back mandatory sign-in, while development onboarding stays in preview.

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

## 3. Microsoft and Apple

Enable Azure under **Authentication → Sign In / Providers**, supply its client credentials, and use `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback` as the provider callback. Microsoft sign-in requests the `email` scope.

Apple replaces GitHub in both desktop and cloud-library sign-in. Existing GitHub identities remain correctly labelled in Account settings; this UI change does not unlink identities or revoke existing sessions.

1. In an Apple Developer account, enable **Sign in with Apple** on Recordly's primary macOS App ID.
2. Register a **Services ID** for browser authentication and associate it with that primary App ID. Register the Supabase callback domain and the exact HTTPS return URL `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`. Apple returns to Supabase; keep Recordly's desktop callback URLs on Supabase's redirect allow list rather than entering them as Apple return URLs.
3. Create a Sign in with Apple private key associated with the primary App ID. Keep the `.p8` key outside the repository and desktop/web bundles. Use the Team ID, Key ID, and Services ID to generate a client-secret JWT.
4. Enable **Apple** in Supabase **Authentication → Sign In / Providers**, using the Services ID as the OAuth client ID and the generated JWT as the secret. Keep the secret server-side in Supabase.
5. Renew the client-secret JWT before it expires (Apple permits at most six months). A disabled Apple provider stays visible but cannot be selected; enabling it in Supabase makes the button usable after provider discovery on the next sign-in opening/page load.
6. Verify Apple sign-in on macOS and Windows through the system browser, plus the cloud library. Check PKCE callback completion, session persistence, cancellation/retry, and Hide My Email. If sending mail to Apple relay addresses, register the sending domains/addresses with Apple's private email relay. Do not infer that an Apple relay address and another provider's email belong to the same account.

The web OAuth flow does not supply the user's full name. Account settings allow a name to be added later; missing names use the existing avatar fallback.

References: [Supabase Apple setup](https://supabase.com/docs/guides/auth/social-sign-in/auth-apple), [Apple web configuration](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/).

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

Restart `npm run dev` after creating `.env.local`. Automatic first-run onboarding, **Settings → Dev → Show onboarding**, and **Review permission setup** all use the same preview flow. No query parameter or separate preview switch is required. Verify Continue, Back, and page navigation with and without a saved account; the restored account stays visible, and Start recording still waits for required system permissions. Native permission requests explicitly select the real flow (`onboardingPreview=0` in development); this route must resume the saved session and pending permission progress without a Skip action. Account sign-in and cloud access continue to use real Supabase sessions.

In a packaged build, verify:

1. Without a session, onboarding requires sign-in before advancing to Permissions.
2. Request an email code. Sending the email alone must not grant access. Verifying the code or opening the magic link establishes a persistent session and advances to Permissions.
3. OAuth opens the system browser and returns to Recordly through the callback.
4. On Permissions, Start recording opens the recording controls after required system permissions are granted.
5. Restart the app to verify session restoration. Sign out from the account dialog and verify mandatory sign-in returns.
6. Review permission setup opens Permissions directly for signed-in users. The recording HUD also checks for a Supabase session before preparing a recording.

Automated UI tests use isolated Supabase endpoints and mocked Auth HTTP responses. Preview tests use the development renderer; authentication and permission-recovery tests use a separate renderer with `NODE_ENV=production`, so development preview cannot mask production sign-in gates.

Add the same `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` values to the share Worker's secrets or variables. Set `OWNER_USER_ID` to the owner’s Supabase user ID. The Worker validates the access token with Supabase and requires that owner identity before accepting API requests. `API_SECRET` is server-side only and remains available for library administration and explicitly enabled local integration tests; it is never entered into or exposed by the desktop app.
