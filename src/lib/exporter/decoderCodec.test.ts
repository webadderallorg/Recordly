import { describe, expect, it, vi } from "vitest";
import {
	getFullyQualifiedCodecCandidates,
	resolveSupportedVideoDecoderConfig,
} from "./decoderCodec";

const SUPPORTED_BY_CHROMIUM = new Set(["vp09.00.10.08", "vp8", "avc1.640033"]);
const chromiumSupportCheck = async (config: VideoDecoderConfig) =>
	SUPPORTED_BY_CHROMIUM.has(config.codec);

describe("getFullyQualifiedCodecCandidates", () => {
	it("maps bare vp09 to fully qualified VP9 strings", () => {
		expect(getFullyQualifiedCodecCandidates("vp09")).toEqual([
			"vp09.00.10.08",
			"vp09.02.10.10",
		]);
	});

	it("maps bare h264 to fully qualified AVC strings", () => {
		expect(getFullyQualifiedCodecCandidates("H264")).toEqual(["avc1.640033", "avc1.42E01E"]);
	});

	it("returns no candidates for unknown codec families", () => {
		expect(getFullyQualifiedCodecCandidates("hevc")).toEqual([]);
	});
});

describe("resolveSupportedVideoDecoderConfig", () => {
	it("keeps an already supported config unchanged", async () => {
		const config = { codec: "vp09.00.10.08", codedWidth: 1920, codedHeight: 1020 };

		const resolved = await resolveSupportedVideoDecoderConfig(config, chromiumSupportCheck);

		expect(resolved).toBe(config);
	});

	it("replaces ambiguous vp09 with a supported fully qualified codec", async () => {
		const config = { codec: "vp09", codedWidth: 1920, codedHeight: 1020 };
		vi.spyOn(console, "warn").mockImplementation(() => {});

		const resolved = await resolveSupportedVideoDecoderConfig(config, chromiumSupportCheck);

		expect(resolved).toEqual({ codec: "vp09.00.10.08", codedWidth: 1920, codedHeight: 1020 });
	});

	it("returns the original config when no candidate is supported", async () => {
		const config = { codec: "hevc", codedWidth: 1920, codedHeight: 1080 };

		const resolved = await resolveSupportedVideoDecoderConfig(config, chromiumSupportCheck);

		expect(resolved).toBe(config);
	});
});
