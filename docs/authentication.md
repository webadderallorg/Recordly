# Recordly authentication setup

**Continue as guest** lets users complete first-run onboarding and use local recording without a Supabase account. Recordly saves the guest choice locally and resumes permission setup after a restart. Cloud features still require a Supabase session. In development, the optional onboarding preview lets users navigate the tour and dismiss it without writing production onboarding settings. Both flows require macOS recording permissions before capture.

The sign-in dialog uses email codes and whichever of Google, Microsoft, or Apple OAuth are enabled in the configured project. Sessions persist across app restarts. The desktop application uses PKCE and returns from the system browser through the loopback callback `http://127.0.0.1:43821/auth/callback` in development and in Windows/Linux builds, and through `recordly://auth/callback` in macOS builds. The loopback return avoids the browser's "Open app?" prompt, which on Windows can silently fail to start the app. The dialog reads `/auth/v1/settings` to determine which provider buttons to enable. SAML is intentionally hidden until configured.

On macOS, signing in or continuing as a guest advances from **Account** to **Permissions**. **Start recording** opens the recording controls once both permissions are granted. Windows and Linux have no permissions step.

Going back to **Account** shows the sign-in form again. **Next** keeps the current session; completing another sign-in replaces it.

Full onboarding plays the welcome music on every opening in both development and packaged builds, including the inline fallback. Previous playback and completion flags do not silence it. The mute control applies to the current opening; blocked autoplay retries on interaction, and closing onboarding or starting a recording stops the music. Dedicated permission recovery stays separate from the full welcome experience: it shares the full-window artwork and outer footer, with 44px permission actions and recording button, but has no account steps, page navigation, or welcome music.

## macOS saved sign-in

New Recordly sign-in entries in macOS Keychain use the label **Recordly Sign-in Cache**. An upgrade can still ask to unlock Electron’s **Recordly Safe Storage** item once. Recordly keeps the existing encrypted session until it has verified that the new item can unlock its replacement. If the migration fails after unlocking the old session, the app continues using the old store and retries on a later launch.

Recordly leaves Electron’s original Keychain item in place. Older builds cannot read the new session format; reinstalling an updated build restores access to a migrated session. Development profiles continue to use Electron’s original storage.

## Routing between desktop instances

`VITE_OAUTH_FLOW_ID_REDIRECTS` is enabled in `.env.example` and the release workflows. It requires Supabase's redirect allow list to preserve `sb_flow_id` on **every** desktop callback: add `recordly://auth/callback\?sb_flow_id=*` and `http://127.0.0.1:43821/auth/callback?sb_flow_id=*` (web URLs cannot contain the backslash; `?` there matches the literal `?`). An accepted callback without query parameters does not prove the queried callback is allowed. Changing this build setting requires rebuilding both Electron and the renderer. Custom and self-hosted configurations without those entries should set it to `false`, which keeps the single-instance callback behavior.

When explicitly enabled, the installed Supabase SDK adds its exact PKCE flow ID to redirects. Starting browser authentication requires working native OS-encrypted storage. The trusted native verifier write binds the flow to its initiating window; no renderer supplies a process ID. A separate protocol launcher forwards only to that flow's registered owner using a private loopback relay. Registry files contain encrypted routing metadata, never callback URLs, authorization codes, or verifiers. Callback transport is authenticated and encrypted with a registration-specific secret that is never transmitted; authenticated acknowledgements are bound to the exact request. Reused process IDs or ports therefore cannot receive a plaintext code or forge a successful handoff.

The initiating window keeps callbacks in its private memory queue during a reload and releases them only to its trusted app document. An acknowledgement means that queue accepted the callback, not that authentication succeeded. A separate launcher exits only after that acknowledgement. Missing, malformed, destroyed, or unavailable owners never cause another instance to try its own verifier. Existing error presentation handles failed returns; this option adds no sign-in dialog and does not change app or recording instance locks.

The encrypted native store uses fresh per-key file transactions across processes. Live or unknown lock owners never expire based on age or wall-clock changes; a busy/unavailable store fails safely. This does not make the SDK's multi-key flow-index operations a single transaction or broadcast account changes between instances.

On Windows, each additional instance uses its own Chromium profile, and Electron keeps the safeStorage key in that profile's `Local State` (DPAPI-protected for the current Windows user). Additional profiles are therefore seeded with the primary profile's key before Chromium starts (`shareSafeStorageKey`), so every instance can read the shared auth store and routing records. A secondary that starts before a brand-new primary has written its key waits briefly for it. A replaced secondary key is kept in `recordly-replaced-safe-storage-keys.json` beside that profile rather than discarded, because data it encrypted cannot be re-encrypted in the same process. macOS and Linux use one app-wide keychain key. Whichever instance holds the loopback return port routes the callback to the flow's owner; other instances retry the port every few seconds and take it over when the holder quits.

On Windows and Linux, browser links that only bring Recordly forward (`recordly://app/open`, `recordly://billing/return`) launch a new process. That process asks the most recently focused running instance to come forward through a token-protected loopback endpoint (`electron/appLinkRelay.ts`), then exits without opening a window. Only a focus request crosses that channel, never a URL or code.

## Account and permission settings

**Settings → Account** is available in both the editor and Projects dashboard. Display-name changes update Supabase user metadata and refresh the account avatar everywhere. Email changes use Supabase's email confirmation flow and the same desktop PKCE callback as sign-in; the existing email stays active until confirmation completes. Pending email changes are shown after reopening Settings. Connected sign-in methods reflect the user's actual account identities. Sign out clears the local session and revokes refresh sessions on all devices; local projects remain on disk. Packaged builds prompt users who signed out to sign in again unless they previously chose guest access in onboarding.

**Settings → Permissions** shows live macOS Screen Recording and Accessibility statuses, refreshes when the app regains focus, and links to the onboarding permission setup. **Allow** for Screen Recording or Accessibility opens the matching System Settings pane and the **Drag to System Settings** panel without asking macOS to show a separate prompt first. Drag Recordly into the permission list and enable it there. Microphone and camera permission requests remain tied to enabling those devices for recording. On other platforms, capture selection remains part of starting a recording.

## 1. Create the project

1. Create a Supabase project.
2. In **Project settings → API**, copy the project URL and publishable key.
3. Copy `.env.example` to `.env.local` and fill in both values. Never use the service-role key in the desktop application.
4. In **Authentication → URL configuration**, add `recordly://auth/callback` and `http://127.0.0.1:43821/auth/callback` to the redirect allow list, plus the `sb_flow_id` entries listed under [Routing between desktop instances](#routing-between-desktop-instances).

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

Restart `npm run dev` after creating `.env.local`. Dev launches open onboarding with an explicit **Skip onboarding** button. **Settings → Dev → Show onboarding** and **Review permission setup** also use the dev preview. If you skip onboarding and then click **Record** without the required macOS permissions, the HUD opens only the system permissions screen, without opening Home or requiring a cloud account. The grants are real; the permission screen doesn't change production onboarding progress. Account sign-in and cloud access still require real Supabase sessions.

In a packaged build, verify:

1. From a new signed-out profile, choose **Continue as guest** and verify that macOS advances to Permissions. On Windows and Linux, verify that the recording controls open.
2. From another new profile, request an email code. Verify that completing sign-in establishes a persistent session and advances onboarding automatically.
3. OAuth opens the system browser and returns to Recordly through the callback.
4. On Permissions, grant the required system permissions and select **Start recording**. If the drag panel doesn't appear, click **+** in the System Settings list and select the Recordly app before turning it on.
5. Restart from System Settings during first-run Permissions and verify that the app resumes setup at Permissions for signed-in users and guests. After completion, restart again and verify that the recording controls open.
6. With a session or saved guest choice, click **Record** with missing macOS grants to verify that Permissions opens directly. Closing Permissions returns you to the recording controls.

On a Mac with a desktop session, run `npm run smoke:packaged-onboarding -- /Applications/Recordly.app/Contents/MacOS/Recordly` to check the packaged app's startup routing. It launches in a temporary, signed-out profile, restarts with permission setup pending, and checks that the carousel remains until onboarding is marked complete. It does not change macOS permissions or replace the manual signed-in grant and restart test.

Automated UI tests use isolated Supabase endpoints and mocked Auth HTTP responses. Preview tests use the development renderer; authentication and permission-recovery tests use a separate renderer with `NODE_ENV=production`, so development preview cannot mask production sign-in gates.

Add the same `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` values to the share Worker's secrets or variables. Set `OWNER_USER_ID` to the owner’s Supabase user ID. The Worker validates the access token with Supabase and requires that owner identity before accepting API requests. `API_SECRET` is server-side only and remains available for library administration and explicitly enabled local integration tests; it is never entered into or exposed by the desktop app.
