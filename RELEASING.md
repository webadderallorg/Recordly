# Releasing Recordly

This repository now uses `electron-builder` + `electron-updater` for macOS, Windows, and Linux auto-updates.

For this Electron app, that is the right path instead of wiring Sparkle.framework directly. On macOS, `electron-updater` handles the release metadata and update flow that Sparkle would otherwise cover in a native app, while still sharing the same GitHub Releases pipeline used by Windows and Linux.

## What the release workflow does

When you publish a GitHub release tagged like `v1.2.3`, `.github/workflows/release.yml` will:

- validate that `package.json` is also `1.2.3`
- build signed macOS x64 and arm64 artifacts
- notarize the macOS builds
- merge the dual-architecture `latest-mac.yml` metadata into one release asset
- build and sign the Windows NSIS installer
- build the Linux AppImage
- publish installer artifacts and auto-update metadata files to the GitHub release
- dispatch the Homebrew tap workflow after the release assets are available

The packaged app then checks GitHub Releases for:

- `latest-mac.yml`
- `latest.yml`
- `latest-linux.yml`

## Required GitHub secrets

### macOS signing and notarization

Set these repository secrets:

- `APPLE_SIGNING_CERTIFICATE_P12_BASE64`
- `APPLE_SIGNING_CERTIFICATE_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

`APPLE_SIGNING_CERTIFICATE_P12_BASE64` must be a base64-encoded `.p12` export of a `Developer ID Application` certificate.

If the certificate you currently have is only `Apple Development`, that is not enough for public notarized releases and auto-update distribution. You need `Developer ID Application`.

To export and encode the certificate:

```bash
security export -k ~/Library/Keychains/login.keychain-db -t identities -f pkcs12 -P "YOUR_P12_PASSWORD" -o recordly-mac-signing.p12
base64 < recordly-mac-signing.p12 | pbcopy
```

Paste the copied base64 into `APPLE_SIGNING_CERTIFICATE_P12_BASE64` and the export password into `APPLE_SIGNING_CERTIFICATE_PASSWORD`.

### Windows signing

Set these repository secrets:

- `WINDOWS_SIGNING_CERTIFICATE_P12_BASE64`
- `WINDOWS_SIGNING_CERTIFICATE_PASSWORD`

These should point to an Authenticode code-signing certificate exported as `.p12` and then base64-encoded.

### Homebrew tap automation

Set this repository secret if you want the cask PR to open automatically:

- `HOMEBREW_TAP_TOKEN`

Optional repository variables:

- `HOMEBREW_TAP_REPO`
- `HOMEBREW_TAP_AUTO_MERGE`

If `HOMEBREW_TAP_REPO` is not set, the workflow defaults to `webadderallorg/homebrew-tap`.

## Release flow

1. Bump `package.json` to the version you want to ship.
2. Commit and push that version.
3. Create a Git tag in the form `vX.Y.Z`.
4. Create and publish a GitHub release for that tag. Prefer the helper so custom notes are prepended while GitHub still generates the contributor section:

```bash
npm run release:create -- --tag v1.2.3 --title "v1.2.3" --notes-file ./release-notes.md
```

For prereleases:

```bash
npm run release:create -- --tag v1.2.0-beta.2 --title "v1.2.0 beta-2" --prerelease --notes-file ./release-notes.md
```

This uses `gh release create --generate-notes`, which keeps GitHub's generated change summary and contributor list instead of replacing it with a fully manual release body.

5. The `Publish Release` workflow builds, signs, notarizes, uploads, and publishes update metadata.

That is the normal path if you want “click new release and let CI do the rest.”

## Rebuilding an existing release

If you need to rerun publishing for an existing tag, use the manual dispatch for `.github/workflows/release.yml` and provide the existing tag.

## Notes

- macOS auto-updates require the `zip` target in addition to `dmg`, because `latest-mac.yml` is generated from the zipped build.
- macOS arm64 and x64 builds both publish updater zips, and the release workflow merges them into one `latest-mac.yml` so `electron-updater` can choose the correct architecture automatically.
- The release workflow publishes versioned artifact names so the generated update metadata matches the uploaded files.
- `build.yml` is intentionally forced to `--publish never` so ad hoc CI builds do not accidentally upload to a draft release.
