# Open Recorder

<p align="center">
  <img src="./branding/source-assets/open-recorder-brand-image.png" width="220" alt="Open Recorder logo">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-111827?style=for-the-badge" alt="macOS Windows Linux" />
  <img src="https://img.shields.io/badge/open%20source-MIT-2563eb?style=for-the-badge" alt="MIT license" />
</p>

### Create polished, pro-grade screen recordings.
[Open Recorder](https://github.com/imbhargav5/open-recorder) is an **open-source screen recorder and editor** for creating **polished walkthroughs, demos, tutorials, and product videos**. Contribution encouraged.

**FAQ**: What are the changes between this and **Openscreen**? A: Open Recorder adds a full cursor animation/rendering pipeline, native screen capture for Mac and Windows, zoom animations faithful to Screen Studio, cursor loops, smoother panning behaviour, and more major tweaks.
> This fork exists because the original maintainer does not wish implementing the architectural changes that make some of these features possible i.e. different recording pipeline.

<p align="center">
  <img src="./open-recorder-demo.gif" width="750" alt="Open Recorder demo video">
</p>

---
## What is Open Recorder?

Open Recorder lets you record your screen and automatically transform it into a polished video. It handles the heavy lifting of zooming into important actions and smoothing out jittery cursor movement so your demos look professional by default.

Open Recorder runs on:

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
  <img src="./CursorLoop.gif" width="450" alt="Open Recorder demo video">
</p>

- Cursor returns to original position in a freeze-frame at end of video/GIF (off by default)

### Editing Tools

- Timeline trimming
- Speed-up / slow-down regions
- Annotations
- Zoom spans
- Project save + reopen (`.openrecorder` files, with `.openscreen` backward compatibility)

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
  <img src="https://i.postimg.cc/d0t09ypT/Screenshot-2026-03-09-at-8-10-08-pm.png" width="700" alt="Open Recorder editor screenshot">
</p>

<p align="center">
  <img src="https://i.postimg.cc/YSgdbvFj/Screenshot-2026-03-09-at-8-49-14-pm.png" width="700" alt="Open Recorder recording interface screenshot">
</p>

---

# Installation

## Download a build

Prebuilt releases are available here:

https://github.com/imbhargav5/open-recorder/releases

## Homebrew (Cask)

Open Recorder is distributed as a GUI app, so Homebrew support is done via cask.

For users:

```bash
brew tap imbhargav5/tap
brew install --cask open-recorder
```

---

## Build from source

```bash
git clone https://github.com/imbhargav5/open-recorder.git
cd open-recorder
npm install
npm run dev
```

---

## Signed macOS releases in GitHub Actions

The manual release workflow at `.github/workflows/release.yml` can produce signed and notarized macOS DMGs when these GitHub repository secrets are configured:

- `CSC_LINK`: base64-encoded `Developer ID Application` `.p12` certificate export
- `CSC_KEY_PASSWORD`: password used when exporting the `.p12`
- `CSC_NAME`: optional full signing identity name, for example `Developer ID Application: Your Name (TEAMID12345)`
- `APPLE_ID`: Apple Developer account email
- `APPLE_APP_SPECIFIC_PASSWORD`: app-specific password for notarization
- `APPLE_TEAM_ID`: your Apple Developer team ID

This repo now includes two helper scripts:

```bash
npm run release:setup-macos-signing
npm run release:dispatch
```

`release:setup-macos-signing` detects the local `Developer ID Application` identity, exports a `.p12`, and uploads the GitHub secrets.

`release:dispatch` checks the current semantic version, asks whether you want a patch, minor, or major release, shows the calculated next tag, asks for confirmation, and then dispatches the `Release Builds` workflow.

Make sure `gh auth login` succeeds before running the release dispatch flow.

---

## macOS: "App cannot be opened"

Local source builds are not signed or notarized by default. macOS may quarantine apps built on your machine.

Remove the quarantine flag with:

```bash
xattr -rd com.apple.quarantine "/Applications/Open Recorder.app"
```

---

# Usage

## Record

1. Launch Open Recorder
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

Save your work anytime as an `.openrecorder` project.

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

Electron's desktop capture API does not allow hiding the system cursor during recording.

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

Open Recorder is a **desktop video editor with a renderer-driven motion pipeline and platform-specific capture layer**.

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
- `.openrecorder` files store the source video path and editor state

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

https://github.com/imbhargav5/open-recorder/issues

Pull requests are welcome.

---

# License

Open Recorder is licensed under the **MIT License**.

---

# Credits

## Acknowledgements

Thanks to [Recordly](https://github.com/AdrianMPC/recordly) and [OpenScreen](https://github.com/siddharthvaddem/openscreen).

---
