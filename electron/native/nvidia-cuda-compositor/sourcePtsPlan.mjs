// Source PTS sidecar decision for the CUDA export pipeline.
//
// The per-packet ffprobe scan that writes the frame PTS sidecar dominates the
// wall time of short 4K exports (~1.7s per 6s clip). It is only consumed when
// a timeline map is present (mapped-callback frame selection needs source PTS)
// or when the wrapper will inline-mux audio (the wrapper validates the native
// summary reports a timestamp-aligned mode before trusting the muxed audio).
// Plain video-only exports with no timeline skip the probe entirely; the native
// compositor's decoder-policy frame selection produces the same output frames.

export function shouldProbeSourcePts(options) {
	const { hasTimelineSegments, videoOnly, forceSourcePts } = options;
	return hasTimelineSegments === true || videoOnly !== true || forceSourcePts === "1";
}
