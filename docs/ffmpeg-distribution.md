# FFmpeg distribution

Recordly runs FFmpeg as a separate executable. Commercial distribution is
permitted by the GPL when its license and corresponding-source requirements are
met. This does not grant permission to restrict recipients' GPL rights.

## macOS builds

The macOS installer helper builds FFmpeg 8.1.2 with statically linked x264 and
libvpx from the archive URLs and SHA-256 hashes in
`scripts/build-redistributable-ffmpeg.mjs`. It retains the `ffmpeg-static` module's
executable path. VideoToolbox, AudioToolbox, AVFoundation, SecureTransport and the
system zlib remain available. Other external libraries are not autodetected;
nonfree components are disabled. All normal internal FFmpeg codecs and filters
remain enabled, subject to their declared dependency requirements.

Build on macOS with Xcode's command-line tools, `make` and `pkg-config` available.
Run `node scripts/install-ffmpeg-static.mjs` from the checkout. Source archives are
verified before extraction and cached in the user's Library/Caches directory;
compilation happens in a private, uniquely named `/tmp/recordly-ffmpeg-*`
directory. Importing the builder module does not start compilation.

`buildMacFfmpeg({ root, arch, destination })` also supports `arch: "x64"` on an
Apple Silicon host. It requests the target architecture explicitly. If NASM is
available, Intel assembly optimizations remain enabled; otherwise the Intel
assembly paths are disabled so the build can finish. Prefer native Intel CI with
NASM when distributing an Intel build. Cross-compilation does not establish that
an Intel executable runs correctly; validate on the target platform.

The helper checks that the executable links only macOS system libraries and,
for the native host architecture, confirms its compiled GPL license. The wrapper
writes the binary hash and build/source provenance to `.distribution.json`.

## Files to preserve and publish

For a built executable `ffmpeg`, the builder creates:

- `ffmpeg.LICENSE`: the complete GPL texts and FFmpeg, x264 and libvpx notices.
- `ffmpeg.README`: version, build identifier and source-distribution instructions.
- `ffmpeg.sources/`: the exact original FFmpeg, x264 and libvpx archives, their
  licenses, this builder script, configure/build commands and configuration logs.
- `ffmpeg.ffprobe`: FFprobe from the same configure/build pass.

Keep the notices with the distributed software. Publish the complete
`ffmpeg.sources` directory, or an archive of it, alongside the binary download at
no additional charge and tell recipients where to find it. Preserve source for
the exact released executable; a newer upstream source version or a generic
project link is insufficient. Include any later modifications and build inputs
in the corresponding-source artifact as well. Do not treat a green binary smoke
test as proof that the source artifact was published.

## Windows and Linux packaging is blocked

Windows and Linux installers are currently blocked by
`scripts/ffmpeg-source-clearance.mjs`, both before packaging and when validating an
existing package. Developer installs remain available, but the approved upstream
binary checksums do not establish source clearance.

Before enabling distribution for either platform, collect and verify the matching
FFmpeg sources, sources for every statically linked dependency, notices, and build
materials for the exact executable. Publish that complete corresponding-source
bundle alongside the installer. A verified binary hash, upstream README, generic
project link, or a newer source version does not replace that bundle. The packaging
gate must continue to reject the target until its source bundle is reviewed and
configured.

For every platform, verify the actual compiled license and configuration of the
release artifact. In particular, the official `b6.1.1` macOS arm64 binary contains
`--enable-nonfree` and says it is not legally redistributable; reinstalling that
same artifact does not correct the problem.
