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

**FAQ**: What are the changes between this and **Openscreen**? A: Recordly adds a full cursor animation/rendering pipeline, native screen capture for Mac and Windows, zoom animations faithful to Screen Studio, cursor loops, smoother panning behaviour, and more major tweaks.
> This fork exists because the original maintainer does not wish implementing the architectural changes that make some of these features possible i.e. different recording pipeline.

<p align="center">
  <img src="./recordlydemo.gif" width="750" alt="Recordly demo video">
</p>

> [!NOTE]
> Huge thank you to **tadees** for supporting the project! This donation directly helps cover the Apple Developer fees to get Recordly signed and notarised for macOS.
[**Support the project**](https://ko-fi.com)


---
## What is Recordly?

Recordly lets you record your screen and automatically transform it into a polished video. It handles the heavy lifting of zooming into important actions and smoothing out jittery cursor movement so your demos look professional by default.

Recordly runs on:

- **macOS**
- **Windows**
- **Linux**

Linux currently use Electron's capture path, which means the OS cursor cannot always be hidden during recording.



---

# Features

### Recording

- Record an entire screen or a single window
- Jump straight from recording into the editor
- Microphone or system audio recording
- Chromium capture APIs on Windows/Linux
- Native **ScreenCaptureKit** capture on macOS
- native WGC recording helper for display and app-window capture on Windows, native WASAPI for system/mic audio, and more

### Smart Motion

- Apple-style zoom animations
- Automatic zoom suggestions based on cursor activity
- Manual zoom regions
- Smooth pan transitions between zoom regions

### Cursor Controls

- Adjustable cursor size
- Cursor smoothing
- Motion blur
- Click bounce animation
- macOS-style cursor assets

### Cursor Loops
<p>
  <img src="./CursorLoop.gif" width="450" alt="Recordly demo video">
</p>

- Cursor returns to original position in a freeze-frame at end of video/GIF (off by default)

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
  <img src="https://i.postimg.cc/d0t09ypT/Screenshot-2026-03-09-at-8-10-08-pm.png" width="700" alt="Recordly editor screenshot">
</p>

<p align="center">
  <img src="https://i.postimg.cc/YSgdbvFj/Screenshot-2026-03-09-at-8-49-14-pm.png" width="700" alt="Recordly recording interface screenshot">
</p>

---

# Installation

## Download a build

Prebuilt releases are available here:

https://github.com/webadderall/Recordly/releases

## Homebrew (Cask)

Recordly is distributed as a GUI app, so Homebrew support is done via cask.

For users:

```bash
brew tap webadderall/tap
brew install --cask recordly
```

---

## Arch Linux / Manjaro (yay)

From the AUR (once the package is published):

```bash
yay -S recordly-bin
```

Or build and install from this repo:

```bash
git clone https://github.com/webadderall/Recordly.git && cd Recordly/packaging/arch && makepkg -si
```

The AUR package is community-maintained. The same PKGBUILD lives in this repo under `packaging/arch/`. For AUR-specific issues or update requests, you can contact the maintainer at **aur@firtoz.com**.

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

### Linux Cursor Capture

Electron’s desktop capture API does not allow hiding the system cursor during recording.

If you enable the animated cursor layer, recordings may contain **two cursors**.

Improving cross-platform cursor capture is an area where contributions are welcome.

---

### System Audio

System audio capture depends on platform support.

**Windows**
- Works out of the box

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
- Windows uses native WGC for screen capture

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

• Tadees

Email youngchen3442@gmail.com for other inquiries or DM me via [@webadderall](https://x.com/webadderall)



---

# License

Recordly is licensed under the **MIT License**.

---

# Credits

## Acknowledgements

Built on top of the excellent [OpenScreen](https://github.com/siddharthvaddem/openscreen) project, you should go check it out!

Created by  
[@webadderall](https://x.com/webadderall)

---

