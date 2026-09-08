# Native device capture helper

This package is an internal, default-off capture backend. Compilation and synthetic
media tests do not establish USB-device, privacy-prompt, signed-app, or release support.

Build from the repository root with `node scripts/build-ios-device-helper.mjs`.
Run native tests with `node scripts/test-ios-device-helper.mjs` on macOS. The package
uses Swift tools 6.0, Swift 5 language mode for AVFoundation/GCD interoperability,
and the existing macOS 14 deployment floor. CaptureEngine state is confined to its
serial queue; preview work and nonblocking control output have separate queues.

The installed executable accepts protocol-v1 NDJSON on stdin/stdout and writes
bounded RLIP previews on fd 3. `--self-test`, `hello`, and `inspectMedia` do not
perform device discovery or request camera/microphone permission. Main allocates
session paths and grants an explicit filename allowlist. The helper never deletes
accepted recording media.

## Current compatibility policy

* The sole candidate screen-device signature is muxed + model `iOS Device`. USB screen sources can advertise muxed media without a standalone video media type; preparation validates actual video samples before readiness.
  A USB iPhone discovery probe confirmed this metadata; first-frame and permission behavior remain unverified. See [discovery evidence](../../../docs/testing/ios-usb-capture-implementation.md).
* CMIO and AVFoundation discovery initialize on the running main run loop. The screen discovery session stays alive across inventory polls and is released when discovery stops.
* Passthrough is limited to positively identified H.264 Baseline profile with
  explicit Rec.709 metadata. Baseline excludes B slices, allowing a bounded final
  sample to preserve a sparse timeline without rebuilding a reordered GOP.
* Other compressed profiles request supported native 420 video-range output during
  preparation. That output must pass the same observed geometry/colour checks.
  There is no mode change during a take and no desktop/camera fallback.
* Raw encoding accepts 8-bit bi-planar Rec.709 SDR. Odd dimensions are padded on the
  right/bottom and their original display aperture is carried into the MOV. RGB,
  unknown/wide colour, HDR, non-square pixels and unsupported apertures fail before
  recording. No colour labels are invented and no unvalidated tone mapping occurs.
* Incoming capture orientation is the delivered pixel orientation, with identity
  output transform. Preview crops the source clean aperture before downscaling.
  The independent movie inspector returns its actual preferred transform.
* Enabled audio outputs request signed 16-bit interleaved PCM. Each sidecar retains
  its host-clock start offset. AVAssetWriter flattens PCM timestamp holes, so gaps
  are explicitly filled with PCM silence and marked as represented in media.
  A gap over one second, more than 128 gaps, timestamp regression or unavailable
  clock mapping interrupts safely instead of inventing alignment or buffering
  unbounded data. Capture counts exclude inserted silence.
* Clock mapping requires a synchronizationClock with measured relative rate within
  one part per million of the host clock. Every PTS/DTS is mapped natively; callback
  receipt times never determine alignment. Non-unit mappings outside this tolerance
  are unsupported, rather than silently stretched. Duration is converted from mapped
  end minus mapped start; PCM comparisons allow one sample of clock-rounding error.
* Preview retains at most one conversion and one partial pipe record. Compressed
  preview frames are decoded independently, JPEG conversion is capped at 5 Hz,
  and dropped compressed work resynchronizes at a keyframe. A blocked fd 3 never
  blocks capture or control output.

The hardware/signing gates, long-duration physical sync, physical rotation/unplug,
preview-stall recording load, corruption/fragment recovery and Intel runtime tests
remain required. Observed frame-rate estimation is not implemented; the optional
field remains null. The H.264 bitrate uses the documented initial policy with a
30 fps tuning input when no observed rate is available; that is not an FPS claim.

## Synthetic evidence

The native XCTest suite covers parser bounds/idempotency, inventory identity,
rational offsets, host-clock identity mapping, no-preparation/no-frame rejection,
wide-colour rejection, actual H.264 encoding and inspection, odd display aperture,
300-second sparse timeline, baseline compressed packet identity and terminal decode,
PCM offsets/internal silence, symlink boundaries and durable timing checkpoints.
The committed synthetic fixture has its generation command and CC0 provenance in
`Tests/IOSCaptureCoreTests/Fixtures/PROVENANCE.md`.

Capture storage reserve uses actual native file sizes for measured write rate. It
reserves an additional video-sized final output only when audio mixing is requested;
uncompressed pixel-buffer memory is never used as a disk-rate estimate.
