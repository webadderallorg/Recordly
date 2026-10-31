# HeroUI UI branch

This migration is isolated on `codex/heroui-ui`, based on `9693ad7` from
`codex/clip-controls`. It lives in the sibling `recordly-heroui` Git worktree.
The original `recordly` checkout and its uncommitted files were left intact.
Nothing has been merged or pushed.

## Try it

From the original checkout:

```sh
cd ../recordly-heroui
npm run dev
```

A fresh checkout needs `npm install` first, including Recordly's normal native
helper installation. The dependency lockfile belongs to this branch.

To go back, close the development app and run `npm run dev` from the original
`recordly` directory. No reset, stash, or file restoration is needed. You can
keep both checkouts while comparing them. To undo just the UI refinement pass,
use `git revert <refinement-commit>`. To undo the entire migration after merging,
revert the branch commits newest-first, including the original `93be193` migration.

## UI approach

The controls use HeroUI React 3.2.6 and its default light/dark theme, following
[the official component demos](https://heroui.com/en/docs/react/components).
This includes buttons, fields, switches, sliders, tabs, tag groups, toggle groups, radios,
selects, modals, popovers, menus, tooltips, color pickers, progress indicators,
skeletons, and toasts. React 19 and Tailwind 4 satisfy HeroUI v3 requirements.
The former Radix, Sonner, and third-party color picker dependencies are removed.

The editor uses a floating inspector card, an open canvas and timeline, aligned
toolbars, consistent spacing, and restrained selection colors. Advanced controls
live behind a per-section switch; changing views preserves project values.
Background types and other exclusive choices use TagGroup. The header follows
native fullscreen state and keeps project titles centered at narrow widths. Floating layers keep one
surface instead of nesting cards and shadows. Timeline blocks retain the original
Recordly palette in both themes. Inspector controls use compact 12–13px text and
32–36px controls, with 14px section titles. Image and video wallpaper grids share
a plus tile for importing and a small remove control on custom tiles, revealed
on hover or keyboard focus. The background gallery slides left/right with tab order.

The clip lane samples real source frames with a bounded cache and one background
video decoder. Sampling follows clip source offsets, speed, and the visible timeline
range; it never seeks the playback element. Zooms use a compact lane with labels
that adapt to block width. The ruler chooses tick density from available width,
and the red playhead has a white centre line. Webcam roundness defaults to 100%;
existing saved values remain intact. New recordings inherit the saved webcam
appearance, and 100% is the maximum squircle radius rather than a circular mask.
Three compact timeline tracks fit before
vertical scrolling. Popovers support outside-click and Escape dismissal and
share one padding layer. Export states retain generous content padding. Timeline
selection ignores pointer jitter up to 4px, including clicks on trim handles,
so selecting a clip cannot introduce a leading gap. Project and preset names truncate inside their rows.
The recorder keeps its compact desktop layout.

The adapters in `src/components/ui` translate existing Recordly state/callback
props to HeroUI APIs. The timeline geometry, crop handles, video canvas, caption
canvas editor, waveform, and native file inputs remain application-specific;
HeroUI does not replace those editing engines. Recording/export/project logic
is retained, with nullable ref types updated for React 19.

## Verification

```sh
npm run typecheck
npm test
npx vite build
npx playwright install chromium
npm run test:ui
```

The production build includes both the renderer and Electron main/preload
bundles. It is not an installer packaging run.

Browser tests use an explicit mocked Electron bridge and a generated six-second
video fixture; they never start a real screen recording. A second changing-frame
fixture verifies that timeline thumbnails decode distinct source frames. They cover control
callbacks and keyboard behavior, modal focus, export settings, presets, cropping,
annotation formatting/undo, project menus, recorder popovers, countdown and update
windows, theme switching, Advanced state, color editing, wallpaper uploads and
keyboard/hover removal, and header/playback
alignment from 800–1440px with and without macOS window controls. Screenshots and failure
traces go to the ignored `test-results/` directory.

`npm run dev:ui` starts only Vite for browser inspection; the component fixture
is at `/tests/ui/controls.html`. The real editor requires Electron or the test
bridge. Native recording, device permissions, and end-to-end media export still
need a desktop smoke test on the target platform.
