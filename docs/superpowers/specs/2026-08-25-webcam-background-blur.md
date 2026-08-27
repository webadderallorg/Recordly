# Webcam background blur specification

## Goal

Add a non-destructive, local-only webcam background blur to Recordly's setup preview,
recording HUD, editor preview, MP4 export, and GIF export. The raw webcam sidecar remains
unchanged and editable.

## Product behavior

- A fresh install starts with blur disabled and strength 12.
- The webcam controls expose a `Blur background` switch and an integer strength slider
  from 1 through 20.
- The launch choice is remembered and snapshotted into a new recording session. Editor
  changes also become the preference for the next recording.
- Old projects, imported webcam media, and old recording manifests default to blur off.
- While the local model loads, Recordly shows raw webcam video. Model or inference failures
  leave the webcam visible and warn once rather than aborting recording or export.
- The effect runs locally from packaged assets. It never uploads frames or downloads a
  model at runtime.

## Technical design

- Add `WebcamBackgroundBlurSettings { enabled, amount }` under
  `WebcamOverlaySettings.backgroundBlur`, recording preferences, and optional version-2
  recording-session manifest data. Project wire versions do not change.
- Use `@tensorflow-models/body-segmentation` with MediaPipe Selfie Segmentation's
  landscape model. Lazy-load one serialized segmenter per renderer and composite with
  threshold 0.5, edge blur 3, and the selected strength.
- A Vite plugin serves a fixed whitelist of MediaPipe package assets in development and
  emits them into `dist` for packaged builds. Third-party notices ship beside them.
- Interactive previews infer at most 15 times per second and reuse the latest processed
  frame. Exports process each distinct webcam source timestamp and cache repeated frames.
- Processing happens before existing webcam crop, mirror, shape, shadow, and
  `post-webcam` extension hooks.
- Blurred jobs are ineligible for the native static-layout compositor and use the existing
  software frame renderer. Native encoders that consume software-rendered frames remain
  available.

## Acceptance

- Setup preview, HUD, editor, MP4, and GIF visibly agree at the same strength.
- Mirroring, cropping, seeks, speed changes, and webcam time offsets remain correct.
- Saving and reopening a project preserves blur; opening legacy data remains unblurred.
- A packaged Windows build loads the model with networking disabled.
- Missing/corrupt assets and inference errors fall back to raw webcam with one warning.

## Exclusions

No virtual camera, transparent background, replacement image, native C++/CUDA model, or
destructive capture-time processing is included.
