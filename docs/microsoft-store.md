# Microsoft Store distribution

Recordly uses electron-builder 26's `appx` target for Store distribution. Microsoft
accepts AppX and MSIX packages and signs approved packages. No purchased code-signing
certificate, USB token, or cloud-signing subscription is needed for this route.
An unsigned artifact is for submission; it is not a trusted direct-download installer.

## Account and identity

Register the appropriate Windows developer account in Partner Center and reserve
the product name before building. Use a durable account the publisher controls.
Choose an account type that accurately reflects the publisher and commercial use;
do not assume a student or hobby account is suitable for a commercial product.
Complete Microsoft's identity, age/guardian and agreement requirements as applicable.

Copy these exact values from Product management > Product identity to repository
Actions variables (or environment variables for a local Windows build):

| Variable | Partner Center field |
| --- | --- |
| `RECORDLY_STORE_IDENTITY_NAME` | Package/Identity/Name |
| `RECORDLY_STORE_PUBLISHER` | Package/Identity/Publisher (including `CN=`) |
| `RECORDLY_STORE_PUBLISHER_DISPLAY_NAME` | Package/Properties/PublisherDisplayName |

Set `RECORDLY_STORE_VERSION` to an increasing `major.minor.patch` for each upload.
Each component must fit 0–65535, major must be nonzero. The manifest's fourth
component is always zero, as required by Store. For example, `2.0.0` creates
`2.0.0.0`; a subsequent package must increase to `2.0.1` or higher. GitHub run
numbers and beta suffixes do not become Store revisions. The packaged app reports
this Store version without changing the repository's version.

## Build

On Windows x64, install the existing native build prerequisites and dependencies,
configure the variables above and the normal production cloud settings, then run:

```powershell
npm run build:win:store
```

The dispatch-only **Microsoft Store package** GitHub workflow performs the same
build and uploads `release/store/Recordly-store-<version>-x64.appx` as an Actions
artifact. It does not create a GitHub release or submit/publish to Microsoft.
The existing direct-download release pipeline is preserved.

The package uses full-trust desktop execution, Windows 10 build 19041 or newer,
the existing `recordly://` auth protocol and bundled native helpers. Only x64 is
currently supported. Store installs disable electron-updater and experimental
update channels; Microsoft Store manages updates. An explicit native update check
opens the Store's updates page. Windows retains the package-generated app identity.

New Store recordings and projects default to `Videos/Recordly`, outside removable
package state. Saved custom recording directories still take precedence. Existing
direct-install recordings are not moved; select their directory in Settings to
reuse them. Test Store uninstall/upgrade behavior before release, including any
custom directory selected inside AppData. Auth/preferences in package data may be
removed by uninstall.

`build/appx` contains Store tile images derived from the existing
`icons/icons/png/1024x1024.png` icon. Regenerate these when the app icon changes:
StoreLogo 50×50, Square44x44Logo 44×44, Square150x150Logo 150×150 and
Wide310x150Logo 310×150 with centered artwork.

## Certification and submission

Before submitting, run the Windows App Certification Kit and install the package
on a clean Windows machine. For pre-Store sideload testing, use an appropriately
trusted development certificate or Microsoft's testing flow; an unsigned artifact
cannot be installed as a trusted Store release. A local build alone is not evidence
of Store approval or runtime compatibility.

Verify:

- Cold/warm launch, `recordly://` login callback and Store-managed updates.
- Screen/window capture, system audio, microphone and webcam with permissions both
  allowed and denied; cursor hooks and multi-window recording controls.
- Native/GPU/software exports, FFmpeg, captions and loopback media servers on a
  machine without developer tools (including required VC++ runtime dependencies).
- Upgrades, uninstall/reinstall, retained videos/projects and existing custom paths.

Draft restricted-capability explanation for `runFullTrust`:

> Recordly is an Electron desktop screen recorder and video editor. It launches
> bundled native helpers for user-initiated Windows screen/window and audio capture,
> cursor tracking, transcription and video export. Full-trust desktop execution is
> required for these Win32 components. Microphone and webcam access support optional
> user-selected recordings. Captured media is stored locally; cloud sharing is
> initiated by the user.

Review that explanation against the submitted build. Provide an accurate privacy
policy, screenshots, feature/paid-cloud descriptions and third-party payment
disclosure. Resolve certification feedback before approving publication. Do not
request borderless capture or broad filesystem capabilities merely to bypass
permissions. Account setup, package identity, Windows runtime testing and final
submission remain separate steps from preparing the build configuration.

References: [Microsoft package requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements?pivots=store-installer-msix),
[developer accounts](https://learn.microsoft.com/en-us/windows/apps/publish/get-started),
[packaged desktop requirements](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-prepare),
[Store policies](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies).
