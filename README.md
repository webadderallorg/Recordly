# Recordly

Language: EN | [简中](README.zh-CN.md)

<p align="center">
  <img src="https://i.postimg.cc/tRnL8gHp/Frame-5.png" width="220" alt="Recordly logo">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-111827?style=for-the-badge" alt="macOS Windows Linux" />
  <img src="https://img.shields.io/badge/open%20source-AGPL3.0-2563eb?style=for-the-badge" alt="AGPL 3.0 license" />
</p>

### Create polished, pro-grade screen recordings.
[Recordly](https://www.recordly.dev) is an open-source screen recorder and editor for walkthroughs, demos, tutorials, product videos, and social clips. Record a screen or window, jump straight into the editor, and export a polished result with cursor effects, zooms, backgrounds, annotations, webcam overlays, and more.

<p align="center">
  <img src="./demo.gif" width="750" alt="Recordly demo video">
</p>

> [!NOTE]
> Huge thank you to **tadees** for supporting the project. This donation helps cover Apple Developer fees for macOS signing and notarization.
[**Support the project**](https://ko-fi.com/webadderall/goal?g=0)

---

## What is Recordly?

Recordly is a desktop app for recording and editing screen captures with motion-driven presentation tools built in. Instead of sending raw footage into a separate editor just to add zooms, cursor polish, or a styled background, Recordly handles that workflow in one place.

Recordly runs on:

- **macOS** 12.3+
- **Windows** 10 Build 19041+
- **Linux** on modern distros

Platform notes:

- **macOS** uses native ScreenCaptureKit-based capture helpers.
- **Windows** uses a native Windows Graphics Capture (WGC) helper on supported builds, with native WASAPI audio support.
- **Linux** records through Electron capture APIs. Cursor hiding is not supported on Linux today.

---

# Core Features

## Auto-zooms, cursor polish, and styled frames
Recordly can automatically emphasize activity with zoom suggestions, smooth cursor movement, add motion effects, and place the final composition inside a styled frame with wallpapers, colors, gradients, blur, padding, and shadows.

<p>
  <img src="./feature1.gif" width="450" alt="Recordly cursor and zoom demo video">
</p>

## Dynamic webcam bubble overlays
Add webcam footage as an overlay bubble, position it with presets or custom coordinates, mirror it, control shadow and roundness, and optionally make it react to zoom so it stays visually balanced during motion.

<p>
  <img src="./feature2.gif" width="450" alt="Recordly webcam overlay demo video">
</p>

## Timeline editing built for demos
Use drag-and-drop timeline tools for zooms, trims, speed regions, annotations, extra audio regions, and crop-aware edits. Save and reopen work as `.recordly` project files.

<p>
  <img src="./feature3.png" width="450" alt="Recordly timeline editor screenshot">
</p>

## All Features

### Recording

- Record an entire display or a single app window
- Jump directly from recording into the editor
- Capture microphone audio and system audio
- Use native capture backends where supported
- Resume editing from saved `.recordly` project files
- Open existing recordings or existing project files from the app

### Timeline and Editing

- Drag-and-drop timeline editing
- Trim unwanted sections
- Add manual zoom regions
- Use automatic zoom suggestions based on cursor activity
- Add speed-up and slow-down regions
- Add text, image, and figure annotations
- Add extra audio regions on the timeline
- Crop the recorded frame
- Save and reopen projects with editor state preserved

### Cursor Controls

- Show or hide the rendered cursor overlay
- Cursor size adjustment
- Cursor smoothing
- Cursor motion blur
- Cursor click bounce
- Cursor sway
- Cursor loop mode for cleaner looping exports
- macOS-style cursor assets for the rendered overlay

### Webcam Overlay

- Enable or disable webcam overlay footage
- Upload, replace, or remove webcam footage
- Mirror webcam footage
- Size control
- Preset positions and custom X/Y placement
- Margin control
- Roundness control
- Shadow control
- Optional zoom-reactive webcam scaling

### Frame Styling and Backgrounds

- Built-in wallpapers
- Runtime wallpaper discovery from the wallpapers directory
- Custom uploaded backgrounds
- Solid color backgrounds
- Gradient backgrounds
- Frame padding
- Rounded corners
- Background blur
- Drop shadows
- Aspect ratio presets for the final frame

### Export

- MP4 export
- GIF export
- Export quality selection
- GIF frame-rate selection
- GIF loop toggle
- GIF size presets
- Aspect ratio and output dimension controls
- Reveal exported files in the system file manager

### Workflow and Usability

- Customizable keyboard shortcuts
- In-app shortcut reference
- Feedback and issue links from the editor
- Project persistence for editor preferences
- Faster preview recovery after export

---

# Screenshots

<p align="center">
  <img src="https://i.postimg.cc/CKxm8DRs/Screenshot-2026-03-20-at-7-07-22-pm.png" width="700" alt="Recordly editor screenshot">
</p>

<p align="center">
  <img src="https://i.postimg.cc/hjwdYRyV/Screenshot-2026-03-20-at-1-53-57-pm.png" width="700" alt="Recordly recording interface screenshot">
</p>

<p align="center">
  <img src="https://i.postimg.cc/Zn9VY6bg/Screenshot-2026-03-18-at-6-32-59-pm.png" width="700" alt="Recordly timeline screenshot">
</p>

---

# Installation

## Download a build

Prebuilt releases are available at:

https://github.com/webadderall/Recordly/releases

---

## Arch Linux / Manjaro (yay)

Install from the AUR ([recordly-bin](https://aur.archlinux.org/packages/recordly-bin)):

```bash
yay -S recordly-bin
```

PKGBUILD, desktop entry, release sync, and optional **local-from-source** packaging live in **[recordly-aur](https://github.com/firtoz/recordly-aur)** so this repository stays free of Arch release chores. For maintainer contact and how the package is updated, see that repo or the AUR package page.

---

## Build from source

```bash
git clone https://github.com/webadderall/Recordly.git recordly
cd recordly
npm install
npm run dev
```

For packaged builds:

```bash
npm run build
```

Target-specific build commands are also available:

- `npm run build:mac`
- `npm run build:win`
- `npm run build:linux`

---

## macOS: "App cannot be opened"

Locally built apps may be quarantined by macOS.

Remove the quarantine flag with:

```bash
xattr -rd com.apple.quarantine /Applications/Recordly.app
```

---

# System Requirements

| Platform | Minimum version | Notes |
|---|---|---|
| **macOS** | macOS 12.3 (Monterey) | Required for ScreenCaptureKit-based capture. |
| **Windows** | Windows 10 20H1 (Build 19041, May 2020) | Required for the native Windows Graphics Capture (WGC) helper and best cursor-hiding behavior. |
| **Linux** | Any modern distro | Recording works through Electron capture. System audio generally requires PipeWire. |

> [!IMPORTANT]
> On Windows builds older than 19041, recording can still work through fallback capture, but the real OS cursor may remain visible in recordings.

---

# Usage

## Record

1. Launch Recordly.
2. Select a screen or window.
3. Choose microphone and system-audio options.
4. Start recording.
5. Stop recording to open the editor.

## Edit

Inside the editor you can:

- add trims, zooms, speed regions, and annotations
- tune cursor behavior and preview volume
- style the frame with wallpapers, colors, gradients, blur, padding, and corners
- add or adjust webcam overlay footage
- add extra audio regions
- crop the frame and choose an aspect ratio

Save your work anytime as a `.recordly` project.

## Export

Export options include:

- **MP4** for standard video output
- **GIF** for lightweight sharing and loops

You can adjust format-specific settings such as quality, GIF frame rate, GIF looping, and output size before export.

---

# Limitations

### Cursor capture

Recordly renders a polished cursor overlay on top of the recording. Platform cursor-hiding behavior still depends on OS support.

**macOS**
- ScreenCaptureKit can exclude the real cursor cleanly.

**Windows**
- Best results require Windows 10 Build 19041+ and the native capture helper.
- Older builds fall back to Electron capture, so the real cursor may remain visible.

**Linux**
- Electron desktop capture does not currently support cursor hiding.
- If you also enable the rendered cursor overlay, exports may show both the real cursor and the styled cursor.

### System audio

System audio support varies by platform.

**Windows**
- Native WASAPI support

**Linux**
- Usually requires PipeWire

**macOS**
- Requires macOS 12.3+ and the ScreenCaptureKit-based workflow

---

# How It Works

Recordly combines a platform-specific capture layer with a renderer-driven editor and export pipeline.

**Capture**
- Electron coordinates recording and application flow
- macOS uses native ScreenCaptureKit helpers
- Windows uses a native Windows Graphics Capture (WGC) helper and native audio helpers where available

**Editing**
- Timeline regions define zooms, trims, speed changes, audio overlays, and annotations
- Cursor and webcam styling are applied in the editor state

**Rendering**
- Scene composition is handled by **PixiJS**

**Export**
- The same scene logic used in preview is rendered into exported MP4 or GIF output

**Projects**
- `.recordly` files store the source media path plus editor state so work can be reopened later

---

# Contribution

Contributions are welcome.

Areas where help is especially useful:

- Linux capture and cursor behavior
- Export performance and stability
- UI and UX refinement
- Localisation work
- Additional editor tools and workflow polish

Please keep pull requests focused, test recording/edit/export flows, and avoid unrelated refactors.

See `CONTRIBUTING.md` for guidelines.

---

# Community

Bug reports and feature requests:

https://github.com/webadderall/Recordly/issues

Pull requests are welcome.

---

# Donations & Sponsors

[Donations](https://ko-fi.com/webadderall/goal?g=0)

Thanks to everyone supporting the project and helping keep Recordly open source.
Ranked in order of size of donation:

- Tadees

- Anonymous supporter
- erwan
- Anonymous supporter

For other inquiries, email `youngchen3442@gmail.com` or DM [@webadderall](https://x.com/webadderall).

---

# License

Recordly is licensed under the **AGPL 3.0**.

---

# Credits

## Acknowledgements

Recordly originally started as a fork of the excellent [OpenScreen](https://github.com/siddharthvaddem/openscreen) project and has since been significantly modified.

Created by  
[@webadderall](https://x.com/webadderall) && Contributors
<a href="https://github.com/webadderall/Recordly/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=webadderall/Recordly" />
</a>


---

