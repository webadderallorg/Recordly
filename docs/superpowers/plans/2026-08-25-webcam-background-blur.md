# Webcam background blur implementation plan

1. Add failing tests for setting normalization, project/editor persistence, dirty state,
   recording preferences, recording-session snapshots, and manifests. Implement the
   shared settings type and optional compatible fields.
2. Add the pinned MediaPipe/TFJS dependencies, build-time asset plugin, asset smoke check,
   dynamic segmentation chunk, and packaged Apache notices. Verify dev and production
   asset URLs without committing generated binaries.
3. Add a tested lazy blur engine with serialized initialization/inference, 15 FPS preview
   throttling, timestamp caching, stale-result suppression, retry/dispose, and raw fallback.
4. Integrate the launch popover and recording HUD through the existing preview stream.
   Add localized switch/slider/status controls and preserve the raw MediaRecorder stream.
5. Integrate editor playback using the synchronized webcam element. Refresh on playback,
   seeks, source changes, toggles, and strength changes.
6. Feed processed canvases into Canvas2D/GIF and Pixi/WebCodecs webcam composition before
   existing presentation effects and hooks. Preflight exports and add the explicit native
   skip reason.
7. Run targeted tests after each slice, then full TypeScript, lint, Vitest, i18n, touched
   formatting, Vite build, asset smoke, packaged Windows smoke, and interactive camera and
   export checks. Commit only after fresh verification.
