# Hidden Teleprompter for Recordly — Design

**Date:** 2026-06-10
**Status:** Approved

## Goal

Add a teleprompter window to Recordly (a fresh copy of
[webadderallorg/Recordly](https://github.com/webadderallorg/Recordly), an Electron +
React/Vite/TS screen recorder) that is **excluded from screen capture**. The user
places it top-center on screen, near the camera, so they appear to look into the
lens while reading a script. The window never appears in recordings.

## Repo setup

- Copy the existing clone at `_external/Recordly` into `Mini Tools/RECORDLY` as a
  **clean copy without the upstream `.git` directory**.
- `Mini Tools` is already a git repository; `RECORDLY` is tracked by it (no nested
  repo).

## Requirements

1. Teleprompter is a separate always-on-top window, hidden from screen capture via
   `BrowserWindow.setContentProtection(true)` — the same mechanism Recordly already
   uses for its HUD overlay (`NSWindowSharingNone` on macOS,
   `WDA_EXCLUDEFROMCAPTURE` on Windows).
2. Script input: type or paste text directly into the window (edit mode).
3. Reading: large high-contrast text that **auto-scrolls at adjustable speed**;
   manual scrolling (wheel/drag/keys) works at any time and pauses auto-scroll.
4. Global hotkeys (work while any app is focused, since the user looks at the
   camera, not the window):
   - `Option/Alt + F8` — play/pause auto-scroll
   - `Option/Alt + F7` — speed down
   - `Option/Alt + F9` — speed up
   - `Option/Alt + T` — show/hide teleprompter window
5. On-window controls: play/pause, speed ±, font size ±, edit/read mode toggle,
   close.
6. Window is focusable (for typing the script), resizable, frameless,
   `skipTaskbar`, defaults to top-center of the primary display.

## Architecture

Follows the existing per-window pattern: `createXWindow()` in
`electron/windows.ts`, renderer routing via `?windowType=...` query param in
`src/App.tsx`, IPC bridged through `electron/preload.ts`.

### New / modified pieces

1. **`electron/windows.ts`** — `createTeleprompterWindow()`, modeled on
   `createHudOverlayWindow()` but `focusable: true`, `resizable: true`. Applies
   `setContentProtection(true)` unconditionally on supported platforms. Default
   bounds: top-center of primary display (e.g. ~480×360, y near top edge). Also
   `getTeleprompterWindow()` and `toggleTeleprompterWindow()`.

2. **IPC + shortcuts** — handlers (module-level in `electron/windows.ts`,
   matching the hud-overlay pattern): `teleprompter-toggle`, `teleprompter-close`
   (toggle covers both launch surfaces; a separate "open" channel proved
   unnecessary). A `globalShortcut` module (first use in this repo) registers
   `Alt+F7/F8/F9` while the teleprompter window exists and unregisters on
   close/quit. Hotkey presses are relayed to the teleprompter renderer via
   `webContents.send("teleprompter-command", cmd)` where
   `cmd ∈ {"toggle-play", "speed-down", "speed-up"}`. `Alt+T` is registered
   app-wide and calls `toggleTeleprompterWindow()`. (Note: while Recordly is
   running, this swallows macOS's `Option+T` "†" character input — acceptable
   for this tool. Shortcut cleanup happens on `will-quit`, not `before-quit`,
   because a quit canceled by the unsaved-changes dialog must not kill hotkeys.)

3. **`electron/preload.ts`** — extend `electronAPI`:
   `teleprompterToggle()`, `teleprompterClose()`,
   `onTeleprompterCommand(cb)` (returns unsubscribe).

4. **`src/App.tsx`** — `case "teleprompter"` → render `<Teleprompter />`.

5. **`src/components/teleprompter/Teleprompter.tsx`** (new) — two modes:
   - **Edit**: textarea for the script, "Start reading" button.
   - **Read**: scrolling script view. Auto-scroll via `requestAnimationFrame`
     advancing `scrollTop` by `speed * dt`; speed adjustable in steps. Manual
     wheel/drag/arrow-key scroll always works and pauses auto-scroll.
     Subscribes to `onTeleprompterCommand`. Control bar: play/pause, speed ±,
     font ±, edit, close. Script text persisted to `localStorage` so it survives
     window close/reopen.

6. **`src/components/launch/popovers/MorePopover.tsx`** — add a "Teleprompter"
   menu item to the HUD's More (⋯) popover, where window/visibility toggles
   already live, so the window can be opened from the HUD.

## Error handling

- If `globalShortcut.register` fails (conflict with another app), log and
  continue — on-window controls still work.
- Content protection is applied before the window is shown; on platforms where
  it's unsupported (some Linux setups), the window still works but is visible in
  capture — same graceful degradation as the existing HUD.
- Hotkeys are unregistered on window close and `app.will-quit` to avoid leaking
  system-wide shortcuts.

## Out of scope (YAGNI)

Mirrored/flipped text, loading scripts from files, multi-script management,
remote/phone control, configurable hotkeys.

## Testing

- Unit tests (vitest, matching repo conventions like `hudOverlayBounds.test.ts`):
  - default top-center bounds calculation
  - auto-scroll position/speed step math (pure functions extracted from the
    component)
- Manual verification: open teleprompter, record the screen with Recordly,
  confirm the teleprompter window does not appear in the recording while
  remaining visible to the user.
