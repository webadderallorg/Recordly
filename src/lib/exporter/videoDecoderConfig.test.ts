import { describe, expect, it, vi } from "vitest";
import type { WebDemuxer } from "web-demuxer";
import { getVideoDecoderConfig } from "./videoDecoderConfig";

function source(codec = "vp09", metadata: Record<string, unknown> = {}) {
	const config: VideoDecoderConfig = {
		codec,
		codedWidth: 1876,
		codedHeight: 954,
		hardwareAcceleration: "prefer-software",
		colorSpace: { primaries: "bt709" },
	};
	const getMediaInfo = vi.fn().mockResolvedValue({
		streams: [
			{ codec_type_string: "audio", codec_string: "opus" },
			{
				codec_type_string: "video",
				profile: "Profile 0",
				pix_fmt: "yuv420p",
				level: -99,
				avg_frame_rate: "60/1",
				bit_rate: "0",
				...metadata,
			},
		],
	});
	const demuxer = {
		getDecoderConfig: vi.fn().mockResolvedValue(config),
		getMediaInfo,
	} as unknown as WebDemuxer;
	return { config, demuxer, getMediaInfo };
}

describe("getVideoDecoderConfig", () => {
	it.each([
		"vp09",
		"vp9",
	])("expands %s for the reported 1876x954 60fps recording", async (codec) => {
		const { config, demuxer } = source(codec);
		expect(await getVideoDecoderConfig(demuxer)).toEqual({
			...config,
			codec: "vp09.00.41.08",
		});
		expect(config.codec).toBe(codec);
	});

	it.each([
		"vp09.02.41.10",
		"vp09.00.41.08.01.01.01.01.00",
		"avc1.640034",
		"vp8",
		"av01.0.08M.08",
	])("preserves an existing %s config without fetching metadata", async (codec) => {
		const { config, demuxer, getMediaInfo } = source(codec);
		expect(await getVideoDecoderConfig(demuxer)).toBe(config);
		expect(getMediaInfo).not.toHaveBeenCalled();
	});

	it.each([
		["Profile 1", "yuv444p", "01.41.08"],
		["Profile 2", "yuv420p10le", "02.41.10"],
		["Profile 2", "yuv420p12be", "02.41.12"],
		["Profile 3", "yuv422p10le", "03.41.10"],
		["unknown", "gbrp12le", "03.41.12"],
	])("uses %s / %s instead of assuming 8-bit profile 0", async (profile, pix_fmt, suffix) => {
		const { demuxer } = source("vp09", { profile, pix_fmt });
		expect((await getVideoDecoderConfig(demuxer)).codec).toBe(`vp09.${suffix}`);
	});

	it("preserves a declared level", async () => {
		const { demuxer } = source("vp09", { level: 51 });
		expect((await getVideoDecoderConfig(demuxer)).codec).toBe("vp09.00.51.08");
	});

	it("uses nominal frame rate when average frame rate is unavailable", async () => {
		const { demuxer } = source("vp09", { avg_frame_rate: "0/0", r_frame_rate: "60/1" });
		expect((await getVideoDecoderConfig(demuxer)).codec).toBe("vp09.00.41.08");
	});

	it("takes source bitrate into account", async () => {
		const { demuxer } = source("vp09", { bit_rate: "40000000" });
		expect((await getVideoDecoderConfig(demuxer)).codec).toBe("vp09.00.50.08");
	});

	it.each([
		{ pix_fmt: "unknown" },
		{ pix_fmt: "yuv420p10le", profile: "Profile 0" },
	])("rejects unknown or inconsistent source metadata: %j", async (metadata) => {
		const { demuxer } = source("vp09", metadata);
		await expect(getVideoDecoderConfig(demuxer)).rejects.toMatchObject({
			name: "NotSupportedError",
		});
	});
});
