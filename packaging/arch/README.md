# Arch Linux / AUR packaging for Recordly

This directory contains the PKGBUILD and helper files for installing Recordly on Arch Linux and Manjaro (via the AUR or locally with `makepkg`).

## Build and install from this repo

```bash
cd packaging/arch
makepkg -si
```

## Updating the package

When a new release is published on [GitHub Releases](https://github.com/webadderall/Recordly/releases):

1. Set `pkgver` in `PKGBUILD` to the new version (e.g. `1.0.10`). Release tags use the form `vX.Y.Z`.
2. If you changed `PKGBUILD` metadata, regenerate `.SRCINFO`:
   ```bash
   makepkg --printsrcinfo > .SRCINFO
   ```
3. For the AUR: commit and push your changes to the `recordly-bin` AUR package repo (branch `master`).

## Submitting to the AUR

See the main repo [README](../../README.md) “Arch Linux / Manjaro (yay)” section and the [AUR submission guidelines](https://wiki.archlinux.org/title/AUR_submission_guidelines). Copy `PKGBUILD`, `.SRCINFO`, `LICENSE`, and `recordly.desktop` into your AUR clone and push to the `master` branch.
