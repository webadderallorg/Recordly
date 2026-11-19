import { expect, it } from "vitest";
import { parseNativeVideoMetadataProbeOutput } from "./metadata";

it("marks native reported FPS and preserves an unknown FPS as a decode fallback", () => {
	const header = "Duration: 00:00:33.732, start: 0.000000\n";
	const line = "Stream #0:0: Video: h264, yuv420p, 1920x1080, 16.327 fps";
	expect(parseNativeVideoMetadataProbeOutput(header + line)).toMatchObject({
		frameRate: 16.327,
		frameRateSource: "metadata",
		duration: 33.732,
	});
	expect(
		parseNativeVideoMetadataProbeOutput(header + line.replace(", 16.327 fps", "")),
	).toMatchObject({ frameRate: 60, frameRateSource: "fallback", duration: 33.732 });
});
