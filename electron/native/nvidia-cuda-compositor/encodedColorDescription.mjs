/**
 * Verifies that the colour description the encoder actually wrote into the
 * output elementary stream matches the tags the export intends to ship.
 *
 * This guard exists because `NV_ENC_CONFIG::encodeCodecConfig` is a union and
 * the H.264/HEVC VUI members sit at different offsets inside their structs:
 * writing both VUI blocks unconditionally let the inactive codec's block
 * overwrite the active one, and the exported HEVC SPS then carried
 * `video_full_range_flag=1` with `colour_primaries=0` instead of the intended
 * limited-range BT.709. Players that trust the bitstream over the container
 * then guess a 4K color space for the mislabelled stream and render the
 * identical bytes with a purple/magenta cast.
 *
 * The muxer always writes the intended `colr` box, so a mismatch reported here
 * means the bitstream and the container disagree and must not be swallowed.
 */

/** libavutil names: "unknown" = absent, "reserved" = out-of-range value. */
function normalizeTag(value) {
	return typeof value === "string" ? value : "unknown";
}

/**
 * @param {{ color_primaries?: string, color_transfer?: string, color_space?: string, color_range?: string } | null | undefined} stream
 * @param {{ primaries: string, transfer: string, matrix: string, range: string }} expectedTags
 */
export function compareEncodedColorDescription(stream, expectedTags) {
	if (!stream) {
		return {
			verified: false,
			reason: "no-video-stream",
			expected: expectedTags,
			actual: null,
		};
	}
	const actual = {
		primaries: normalizeTag(stream.color_primaries),
		transfer: normalizeTag(stream.color_transfer),
		matrix: normalizeTag(stream.color_space),
		range: normalizeTag(stream.color_range),
	};
	const mismatches = [];
	for (const [field, actualValue] of Object.entries(actual)) {
		const expectedValue = expectedTags[field];
		if (actualValue !== expectedValue) {
			mismatches.push(`${field}=${actualValue} (expected ${expectedValue})`);
		}
	}
	return {
		verified: mismatches.length === 0,
		reason: mismatches.length ? mismatches.join(", ") : null,
		expected: expectedTags,
		actual,
	};
}
