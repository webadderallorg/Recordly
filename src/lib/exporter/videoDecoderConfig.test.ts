import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	configureVideoDecoder,
	FALLBACK_H264_CODEC,
	normalizeVideoDecoderConfig,
} from "./videoDecoderConfig";

describe("normalizeVideoDecoderConfig", () => {
	it.each([
		["av01", "av01.0.01M.08"],
		["h264", FALLBACK_H264_CODEC],
		["avc1", FALLBACK_H264_CODEC],
		["vp08", "vp8"],
		["vp09", "vp9"],
	])("normalizes %s to %s", (codec, expected) => {
		expect(normalizeVideoDecoderConfig({ codec }).codec).toBe(expected);
	});

	it("preserves complete codec strings and decoder metadata", () => {
		const description = new Uint8Array([1, 2, 3]);
		const config: VideoDecoderConfig = {
			codec: "avc1.42c032",
			codedWidth: 1920,
			codedHeight: 1080,
			description,
		};

		expect(normalizeVideoDecoderConfig(config)).toBe(config);
	});
});

describe("configureVideoDecoder", () => {
	const configure = vi.fn();
	const isConfigSupported = vi.fn();

	beforeEach(() => {
		configure.mockReset();
		isConfigSupported.mockReset();
		vi.stubGlobal("VideoDecoder", { isConfigSupported });
	});

	it("falls back when a malformed AVC codec string is unsupported", async () => {
		isConfigSupported.mockImplementation(async (config: VideoDecoderConfig) => ({
			supported: config.codec === FALLBACK_H264_CODEC,
			config,
		}));

		const configured = await configureVideoDecoder({ configure } as unknown as VideoDecoder, {
			codec: "avc1.2420032",
			codedWidth: 2048,
			codedHeight: 1152,
		});

		expect(configured.codec).toBe(FALLBACK_H264_CODEC);
		expect(configure).toHaveBeenCalledOnce();
		expect(configure).toHaveBeenCalledWith(
			expect.objectContaining({ codec: FALLBACK_H264_CODEC }),
		);
	});

	it("tries software decoding first for VP9", async () => {
		isConfigSupported.mockResolvedValue({ supported: true });

		await configureVideoDecoder({ configure } as unknown as VideoDecoder, {
			codec: "vp09",
			codedWidth: 1920,
			codedHeight: 1080,
		});

		expect(configure).toHaveBeenCalledWith(
			expect.objectContaining({ codec: "vp9", hardwareAcceleration: "prefer-software" }),
		);
	});
});
