# Opening a PR to upstream (webadderall/Recordly)

This repo has **two variants** of the Arch/AUR packaging:

- **Your fork (e.g. branch `feat/yay`):** Full version with AUR auto-update workflow, maintainer contact aur@firtoz.com, and automation. Use this for your own fork and for the AUR.
- **Upstream PR:** Trimmed version that upstream can merge without maintaining the AUR or storing secrets. No workflow, generic maintainer/contact.

To open a PR to **webadderall/Recordly** without the “weird” bits (your email, your AUR key, automation only you can run):

1. Create a branch for the PR, e.g. `feat/yay-upstream-pr`, from your current `feat/yay`.
2. Apply the changes below (remove workflow, use placeholder maintainer and generic contact).
3. Push `feat/yay-upstream-pr` to your fork and open a PR **from that branch** into `webadderall/Recordly` `main`.
4. Keep using `feat/yay` (full version) in your fork; no need to change it.

---

## 1. Remove the AUR auto-update workflow

Delete the file (only in the PR branch):

- `.github/workflows/update-aur.yml`

Upstream doesn’t need it; it’s for your fork and your AUR key.

---

## 2. PKGBUILD – maintainer line (upstream version)

In `packaging/arch/PKGBUILD`, replace the first line with a placeholder so upstream or the merger can set it:

```text
# Maintainer: Your Name <you at example dot com>
```

(They or you can change it after merge; the AUR package page will still show whoever pushes to the AUR.)

---

## 3. packaging/arch/README.md – upstream version

Replace the whole file with this (no firtoz contact, no auto-update section):

```markdown
# Arch Linux / AUR packaging for Recordly

This directory contains the PKGBUILD and helper files for installing Recordly on Arch Linux and Manjaro (via the AUR or locally with `makepkg`).

For issues or update requests about the **recordly-bin** AUR package, see the [AUR package page](https://aur.archlinux.org/packages/recordly-bin) for the current maintainer.

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
```

---

## 4. Main README – Arch section (upstream version)

In the root `README.md`, in the Arch Linux / Manjaro section, replace the sentence that mentions aur@firtoz.com with:

```text
The AUR package is community-maintained. The same PKGBUILD lives in this repo under `packaging/arch/`. For AUR-specific issues or the current maintainer, see the [recordly-bin AUR page](https://aur.archlinux.org/packages/recordly-bin).
```

---

## 5. Do not include this file in the PR

Remove or do not add `packaging/arch/UPSTREAM_PR.md` in the branch you use for the upstream PR (it’s only for your reference in the fork). If it’s already tracked, drop it from the PR branch with `git rm packaging/arch/UPSTREAM_PR.md` and commit.

---

After applying 1–4 (and 5 if needed), commit on `feat/yay-upstream-pr`, push, and open the PR. Your `feat/yay` branch stays as the full variant for your fork and AUR automation.
