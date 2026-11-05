import { afterEach, describe, expect, it, vi } from "vitest";

import { getOrderedSupportedMp4EncoderCandidates, probeSupportedMp4Dimensions } from "./mp4Support";

describe("getOrderedSupportedMp4EncoderCandidates", () => {
	it("keeps hardware candidates ahead of a preferred software hint", () => {
		const candidates = getOrderedSupportedMp4EncoderCandidates({
			codec: "avc1.640033",
			preferredEncoderPath: {
				codec: "avc1.640033",
				hardwareAcceleration: "prefer-software",
			},
		});

		expect(candidates[0]).toEqual({
			codec: "avc1.640033",
			hardwareAcceleration: "prefer-hardware",
		});
		expect(candidates[1]).toEqual({
			codec: "avc1.640034",
			hardwareAcceleration: "prefer-hardware",
		});
		expect(candidates).toContainEqual({
			codec: "avc1.640033",
			hardwareAcceleration: "prefer-software",
		});
		expect(
			candidates.findIndex((candidate) => {
				return (
					candidate.codec === "avc1.640033" &&
					candidate.hardwareAcceleration === "prefer-software"
				);
			}),
		).toBeGreaterThan(
			candidates.findIndex((candidate) => {
				return (
					candidate.codec === "avc1.42001f" &&
					candidate.hardwareAcceleration === "prefer-hardware"
				);
			}),
		);
	});

	it("preserves a preferred hardware path at the front of the list", () => {
		const candidates = getOrderedSupportedMp4EncoderCandidates({
			codec: "avc1.640033",
			preferredEncoderPath: {
				codec: "avc1.4d401f",
				hardwareAcceleration: "prefer-hardware",
			},
		});

		expect(candidates[0]).toEqual({
			codec: "avc1.4d401f",
			hardwareAcceleration: "prefer-hardware",
		});
	});
});

describe("high-resolution MP4 support", () => {
	afterEach(() => vi.unstubAllGlobals());
	it("tries level 5.2 at 4K/60 before reducing the source dimensions", async () => {
		const probe = vi.fn(async (config: VideoEncoderConfig) => ({
			supported: config.codec === "avc1.640034",
			config,
		}));
		vi.stubGlobal("VideoEncoder", { isConfigSupported: probe });
		const result = await probeSupportedMp4Dimensions({
			width: 3840,
			height: 2160,
			frameRate: 60,
			getBitrate: () => 149_299_200,
		});
		expect(result).toMatchObject({
			width: 3840,
			height: 2160,
			capped: false,
			encoderPath: { codec: "avc1.640034", hardwareAcceleration: "prefer-hardware" },
		});
		expect(
			probe.mock.calls.every(([config]) => config.width === 3840 && config.height === 2160),
		).toBe(true);
	});
	it("continues through rejected codec probes and preserves portrait originals", async () => {
		vi.stubGlobal("VideoEncoder", {
			isConfigSupported: async (config: VideoEncoderConfig) => {
				if (config.codec !== "avc1.640034")
					throw new TypeError("Unsupported codec profile");
				return { supported: true, config };
			},
		});
		expect(
			await probeSupportedMp4Dimensions({
				width: 2160,
				height: 3840,
				frameRate: 60,
				getBitrate: () => 149_299_200,
			}),
		).toMatchObject({ width: 2160, height: 3840, capped: false });
	});
	it("still scales down when no encoder supports the original dimensions", async () => {
		vi.stubGlobal("VideoEncoder", {
			isConfigSupported: async (config: VideoEncoderConfig) => ({
				supported: config.width <= 1920 && config.height <= 1080,
				config,
			}),
		});
		const result = await probeSupportedMp4Dimensions({
			width: 5120,
			height: 2880,
			frameRate: 60,
			getBitrate: () => 100_000_000,
		});
		expect(result.encoderPath).not.toBeNull();
		expect(result.capped).toBe(true);
		expect(result.width).toBeLessThanOrEqual(1920);
		expect(result.height).toBeLessThanOrEqual(1080);
	});
});
