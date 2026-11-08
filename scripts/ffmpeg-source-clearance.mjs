/**
 * Packaging requires more than a verified upstream executable and license text.
 * Mac builds have pinned corresponding source enforced by verifyFfmpegDistribution.
 * The approved upstream Windows/Linux binaries do not yet have a complete reviewed
 * source/dependency/build-material bundle. Keep developer installs available, but
 * fail packaging and packaged validation until those exact bundles are collected.
 */
export function assertFfmpegSourceClearance({ platform, arch }) {
	if (platform === "darwin" && (arch === "arm64" || arch === "x64")) return;
	if (platform === "win32" || platform === "linux") {
		throw new Error(
			`FFmpeg source clearance is incomplete for ${platform}/${arch}. ` +
				"Do not distribute this installer: collect and verify the matching FFmpeg, " +
				"statically linked dependency sources, notices and build materials first. " +
				"A verified binary checksum or upstream README is not a source bundle.",
		);
	}
	throw new Error(`No reviewed FFmpeg source bundle is configured for ${platform}/${arch}.`);
}
