# Recordly

Language: EN | [简中](README.zh-CN.md)

<p align="center">
  <img src="https://i.postimg.cc/tRnL8gHp/Frame-5.png" width="220" alt="Recordly logo">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-111827?style=for-the-badge" alt="macOS Windows Linux" />
  <img src="https://img.shields.io/badge/open%20source-MIT-2563eb?style=for-the-badge" alt="MIT license" />
</p>

### Create polished, pro-grade screen recordings.
[Recordly](https://www.recordly.dev) is an **open-source screen recorder and editor** for creating **polished walkthroughs, demos, tutorials, and product videos**. Contribution encouraged.
<p align="center">
  <img src="./demo.gif" width="750" alt="Recordly demo video">
</p>

> [!NOTE]
> Huge thank you to **tadees** for supporting! This donation directly helps cover the Apple Developer fees to get Recordly signed and notarised for macOS. Still waiting for Apple approval.
[**Support the project**](https://ko-fi.com/webadderall/goal?g=0)

---
## What is Recordly?

Recordly lets you record your screen and automatically transform it into a polished video. It handles the heavy lifting of zooming into important actions and smoothing out jittery cursor movement so your demos look professional by default.

Recordly runs on:

- **macOS** 12.3+
- **Windows** 10 Build 19041+
- **Linux** (modern distros)

On Windows, builds older than 19041 fall back to Electron capture and the cursor cannot be hidden. On Linux, cursor hiding is not supported (contribute).



---

# Core Features

## Auto-zooms, silky cursor & beautiful backgrounds
Recordly adds beautiful cursor animations and auto-zooming plus a background to your recordings so you can spend less time editing and more time shipping.
<p>
  <img src="./feature1.gif" width="450" alt="Recordly sway demo video">
</p>

## Dynamic bubble webcam overlay
Record your face with smart webcam bubbles that expand and shrink to make sure you get the spotlight when you need to. Perfect for demos and tutorials.
<p>
  <img src="./feature2.gif" width="450" alt="Recordly sway demo video">
</p>

## Intuitive timeline editing interface
Use drag-and-drop pieces to control video speed, zooms, annotations, audio tracks and video length, and save your projects as .recordly files so you can save your progress or edit other projects.
<p>
  <img src="./feature3.png" width="450" alt="Recordly sway demo video">
</p>

## All features
### Cursor Animations
<p>
  <img src="./CursorSwayDemo.gif" width="450" alt="Recordly sway demo video">
</p>

- Adjustable cursor size
- Cursor smoothing
- Motion blur
- Click bounce animation
- macOS-style cursor assets
- Cursor sway effects

### Recording

- Record an entire screen or a single window
- Jump straight from recording into the editor
- Microphone or system audio recording
- Chromium capture APIs on Windows/Linux
- Native **ScreenCaptureKit** capture on macOS
- native DXGI Desktop Duplication recording helper for display and app-window capture on Windows, native WASAPI for system/mic audio, and more

### Smart Motion

- Apple-style zoom animations
- Automatic zoom suggestions based on cursor activity
- Manual zoom regions
- Smooth pan transitions between zoom regions

### Infinite Loops
<p>
  <img src="./CursorLoop.gif" width="450" alt="Recordly gif loop demo video">
</p>

- Toggle to make cursor return to original position at end of video/GIF for clean loops

### Editing Tools

- Timeline trimming
- Speed-up / slow-down regions
- Annotations
- Zoom spans
- Project save + reopen (`.recordly` files)

### Frame Styling

- Wallpapers
- Gradients
- Solid fills
- Padding
- Rounded corners
- Blur
- Drop shadows

### Export

- MP4 video export
- GIF export
- Aspect ratio controls
- Quality settings

---

# Screenshots

<p align="center">
  <img src="https://i.postimg.cc/CKxm8DRs/Screenshot-2026-03-20-at-7-07-22-pm.png" width="700" alt="Recordly editor screenshot">
</p>


<p align="center">
  <img src="https://i.postimg.cc/hjwdYRyV/Screenshot-2026-03-20-at-1-53-57-pm.png" width="700" alt="Recordly recording interface screenshot">
</p>

<p align="center">
  <img src="https://i.postimg.cc/Zn9VY6bg/Screenshot-2026-03-18-at-6-32-59-pm.png" width="700" alt="Recordly recording interface screenshot">
</p>

---

# Installation

## Download a build

Prebuilt releases are available here:

https://github.com/webadderall/Recordly/releases

---

## Build from source

```bash
git clone https://github.com/webadderall/Recordly.git recordly
cd recordly
npm install
npm run dev
```

---

## macOS: "App cannot be opened"

Recordly is not signed. macOS may quarantine locally built apps.

Remove the quarantine flag with:

```bash
xattr -rd com.apple.quarantine /Applications/Recordly.app
```

---

# System Requirements

| Platform | Minimum version | Notes |
|---|---|---|
| **macOS** | macOS 12.3 (Monterey) | Required for ScreenCaptureKit. Recording and cursor hiding will not work on older versions. |
| **Windows** | Windows 10 20H1 (Build 19041, May 2020) | Required for the native DXGI Desktop Duplication helper. Older builds fall back to Electron browser capture — cursor will be visible in recordings. |
| **Linux** | Any modern distro | Recording works via Electron capture. Cursor is always visible in recordings. System audio requires PipeWire (Ubuntu 22.04+, Fedora 34+). |

> [!IMPORTANT]
> On Windows, if your build is older than 19041, recording will still work but **the cursor cannot be hidden** from the captured video.

---

# Usage

## Record

1. Launch Recordly
2. Select a screen or window
3. Choose audio recording options
4. Start recording
5. Stop recording to open the editor

---

## Edit

Inside the editor you can:

- Add zoom regions manually
- Use automatic zoom suggestions
- Adjust cursor behavior
- Trim the video
- Add speed changes
- Add annotations
- Style the frame

Save your work anytime as a `.recordly` project.

---

## Export

Export options include:

- **MP4** for full-quality video
- **GIF** for lightweight sharing

Adjust:

- Aspect ratio
- Output resolution
- Quality settings

---

# Limitations

### Cursor Capture (We overlay a second animated cursor over the original hidden one)

**macOS**: Cursor is excluded from the recording at the ScreenCaptureKit level — always clean.

**Windows**: Cursor exclusion depends on the native DXGI Desktop Duplication helper plus OS cursor hide/show, and requires **Windows 10 Build 19041+**. On older builds the app falls back to Electron’s browser capture and the real cursor will be visible in the recording.

**Linux**: Electron’s desktop capture API does not support cursor hiding. The real OS cursor will always be visible in recordings. If you also enable the animated cursor overlay in the editor, you may see **two cursors** in the output.

Improving cross-platform cursor capture is an area where contributions are welcome.

---

### System Audio

System audio capture depends on platform support.

**Windows**
- Works out of the box via native WASAPI
- Requires Windows 10 Build 19041+

**Linux**
- Requires PipeWire (Ubuntu 22.04+, Fedora 34+)
- Older PulseAudio setups may not support system audio

**macOS**
- Requires macOS 12.3+
- Uses ScreenCaptureKit helper

---

# How It Works

Recordly is a **desktop video editor with a renderer-driven motion pipeline and platform-specific capture layer**.

**Capture**
- Electron orchestrates recording
- macOS uses native helpers for ScreenCaptureKit and cursor telemetry
- Windows uses a native DXGI Desktop Duplication helper for screen capture

**Motion**
- Zoom regions
- Cursor tracking
- Speed changes
- Timeline edits

**Rendering**
- Scene composition handled by **PixiJS**

**Export**
- Frames rendered through the same scene pipeline
- Encoded to MP4 or GIF

**Projects**
- `.recordly` files store the source video path and editor state

---

# Contribution

All contributors welcomed!

Areas where help is especially valuable:

- Smooth cursor pipeline for **Linux**
- **Webcam** overlay bubble
- **Localisation** support, especially Chinese
- UI/UX **design** **improvements**
- **Export speed** improvements

Please:
- Keep pull requests **focused and modular**
- Test playback, editing, and export flows
- Avoid large unrelated refactors

See `CONTRIBUTING.md` for guidelines.

---

# Community

Bug reports and feature requests:

https://github.com/webadderall/Recordly/issues

Pull requests are welcome.

---

# Donations & Sponsors

[Donations](https://ko-fi.com/webadderall/goal?g=0)

Greatful for all supporters, you are helping Recordly stay open-source and supporting development.

• Tadees

• Anonymous supporter
• Anonymous supporter

Email youngchen3442@gmail.com for other inquiries or DM me via [@webadderall](https://x.com/webadderall)



---

# License

Recordly is licensed under the **MIT License**.

---

# Credits

## Acknowledgements

Originally built on top of the excellent [OpenScreen](https://github.com/siddharthvaddem/openscreen) project.
> Recordly originally started as a fork of OpenScreen, and is expanded to include a full cursor animation/rendering pipeline, native macOS and Windows screen recording workflow, an animated webcam overlay bubble system, zoom animations faithful to Screen Studio, cursor loops, audio tracks, and more major features.

Created by  
[@webadderall](https://x.com/webadderall)

---

