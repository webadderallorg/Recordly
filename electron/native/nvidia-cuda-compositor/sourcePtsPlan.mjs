// Source PTS sidecar decision for the CUDA export pipeline.
//
// The per-packet ffprobe scan that writes the frame PTS sidecar dominates the
// wall time of exports (~1.7s per 6s clip; ~0.28x the recording duration, so
// minutes on long recordings). It is only consumed when a timeline map is
// present (mapped-callback frame selection needs source PTS) or when the
// wrapper will inline-mux audio and the native summary must report a
// timestamp-aligned mode before the muxed audio is trusted.
//
// For a provably constant-frame-rate source the computed CFR timestamps
// (frameIndex / sourceFps) are exactly the real packet PTS, so the synthetic
// sidecar produces the same frame selection as the full-file scan — including
// for timeline mapping, where source ranges in milliseconds map to exact
// frame indices on CFR content. This eliminates the O(duration) ffprobe scan
// for Recordly's own CFR H.264 captures. The scan is retained for VFR or
// unknown-rate sources (timeline or inline-audio), explicit
// RECORDLY_NVIDIA_CUDA_FORCE_SOURCE_PTS=1 diagnostics, and inline-audio mux
// on a source that is not provably CFR, where packet PTS validation is
// genuinely required.

function parsePositiveRational(value) {
	if (typeof value !== "string") {
		return null;
	}
	const parts = value.split("/");
	if (parts.length !== 2) {
		return null;
	}
	const numerator = Number(parts[0]);
	const denominator = Number(parts[1]);
	if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) {
		return null;
	}
	if (numerator <= 0 || denominator <= 0) {
		return null;
	}
	return { numerator, denominator };
}

// Relative tolerance between avg_frame_rate and r_frame_rate below which a
// source counts as constant-frame-rate. Recordly's muxer writes avg_frame_rate
// at microsecond precision (e.g. "1000000/33333" = 30.0003 vs r_frame_rate
// "30/1"), so exact rational equality would misclassify Recordly's own CFR
// output as variable-rate and force the full-file scan. True VFR sources
// typically differ by well over 2% (their average is far below the maximum
// instantaneous rate), so 2% cleanly separates the two.
const CFR_FRAME_RATE_TOLERANCE = 0.02;

/**
 * Parses an ffprobe frame-rate rational ("30/1", "30000/1001") into a positive
 * frames-per-second number. Returns 0 when the value is missing or unusable
 * (ffprobe reports unknown rates as "0/0").
 */
export function parseRationalFps(value) {
	const rational = parsePositiveRational(value);
	return rational ? rational.numerator / rational.denominator : 0;
}

/**
 * True when ffprobe metadata proves the source video is constant-frame-rate:
 * avg_frame_rate is within a small relative tolerance of r_frame_rate. VFR
 * sources have a much lower average than their maximum instantaneous rate, so
 * a mismatch beyond the tolerance is a conservative signal that the
 * per-packet PTS scan is still required.
 */
export function isConstantFrameRateSource({ avgFrameRate, rFrameRate }) {
	const avg = parsePositiveRational(avgFrameRate);
	const rFrame = parsePositiveRational(rFrameRate);
	if (!avg || !rFrame) {
		return false;
	}
	const avgFps = avg.numerator / avg.denominator;
	const rFps = rFrame.numerator / rFrame.denominator;
	if (!(rFps > 0) || !Number.isFinite(avgFps)) {
		return false;
	}
	return Math.abs(avgFps - rFps) / rFps <= CFR_FRAME_RATE_TOLERANCE;
}

/**
 * Resolves how the wrapper must produce source frame PTS.
 *
 * Returns { mode, reason } where mode is one of:
 *  - "probe": run the full per-packet ffprobe scan (explicit force flag,
 *    VFR/unknown source with timeline or inline-audio mux).
 *  - "synthesize-cfr": write the sidecar analytically from avg_frame_rate
 *    (constant-frame-rate source with or without a timeline map; identical
 *    selection to the real scan at zero cost).
 *  - "skip": no sidecar at all (video-only exports without a timeline map;
 *    the native compositor's decoder-policy ordinal selection is equivalent).
 */
export function resolveSourcePtsPlan(options) {
	const {
		hasTimelineSegments,
		videoOnly,
		forceSourcePts,
		muxAudioInline,
		isConstantFrameRateSource: constantFrameRate,
		hasSourceFrameRate,
	} = options;

	// The force flag always wins — it is a diagnostics opt-in to the full scan.
	if (forceSourcePts === "1") {
		return { mode: "probe", reason: "force-flag" };
	}
	// Video-only exports with no timeline map skip the sidecar entirely; the
	// native compositor's decoder-policy ordinal selection is equivalent.
	if (videoOnly === true && !hasTimelineSegments) {
		return { mode: "skip", reason: "video-only" };
	}
	// For a provably constant-frame-rate source the computed PTS
	// (frameIndex / sourceFps) are exactly the real packet PTS, so the
	// synthetic sidecar produces the same frame selection as the full-file
	// scan — including for timeline mapping, where source ranges in
	// milliseconds map to exact frame indices on CFR content. This eliminates
	// the O(duration) ffprobe scan for Recordly's own CFR H.264 captures.
	if (constantFrameRate === true && hasSourceFrameRate === true) {
		return {
			mode: "synthesize-cfr",
			reason: hasTimelineSegments ? "cfr-timeline" : "plain-cfr-copy-source",
		};
	}
	// VFR or unknown frame rate: the per-packet scan is required for both
	// timeline mapping (frame selection depends on real PTS) and inline-audio
	// alignment. Video-only without a timeline already returned "skip" above.
	if (hasTimelineSegments) {
		return { mode: "probe", reason: "timeline-map-vfr" };
	}
	if (videoOnly === true || muxAudioInline !== true) {
		return { mode: "skip", reason: "video-only" };
	}
	return { mode: "probe", reason: "non-trivial-audio-alignment" };
}

/**
 * True when the full-file per-packet source-PTS scan must run. Kept as a thin
 * predicate over resolveSourcePtsPlan so callers and tests can ask directly.
 */
export function shouldProbeSourcePts(options) {
	return resolveSourcePtsPlan(options).mode === "probe";
}

/**
 * True when the wrapper can write the source-PTS sidecar analytically for a
 * plain constant-frame-rate copy-source export instead of scanning the file.
 */
export function shouldSynthesizeCfrSourcePts(options) {
	return resolveSourcePtsPlan(options).mode === "synthesize-cfr";
}
