import { describe, expect, it } from "vitest";

import { resolveMp4ExportSettings } from "./mp4ExportSettings";

const baseOptions = {
	smokeExportConfig: {
		enabled: false,
	},
	settings: {},
	exportQuality: "high" as const,
	exportEncodingMode: "balanced" as const,
	mp4FrameRate: 30 as const,
	exportVideoCodec: "h264" as const,
	exportEncoderPreference: "auto" as const,
	exportBitrateMode: "auto" as const,
	exportBitrateMbps: 20,
};

describe("resolveMp4ExportSettings", () => {
	it("uses editor defaults when neither menu settings nor smoke settings override them", () => {
		expect(resolveMp4ExportSettings(baseOptions)).toEqual({
			quality: "high",
			encodingMode: "balanced",
			selectedMp4FrameRate: 30,
			exportVideoCodec: "h264",
			exportEncoderPreference: "auto",
			exportBitrateMode: "auto",
			exportBitrateMbps: 20,
		});
	});

	it("prefers explicit menu settings over editor defaults for normal exports", () => {
		expect(
			resolveMp4ExportSettings({
				...baseOptions,
				settings: {
					quality: "source",
					encodingMode: "quality",
					mp4FrameRate: 60,
					exportVideoCodec: "hevc",
					exportEncoderPreference: "cpu",
					exportBitrateMode: "custom",
					exportBitrateMbps: 35,
				},
			}),
		).toEqual({
			quality: "source",
			encodingMode: "quality",
			selectedMp4FrameRate: 60,
			exportVideoCodec: "hevc",
			exportEncoderPreference: "cpu",
			exportBitrateMode: "custom",
			exportBitrateMbps: 35,
		});
	});

	it("prefers smoke URL settings over menu settings when smoke export is enabled", () => {
		expect(
			resolveMp4ExportSettings({
				...baseOptions,
				smokeExportConfig: {
					enabled: true,
					quality: "medium",
					encodingMode: "fast",
					fps: 24,
					videoCodec: "hevc",
					encoderPreference: "hardware",
					bitrateMode: "custom",
					bitrateMbps: 25,
				},
				settings: {
					quality: "source",
				},
			}),
		).toEqual({
			quality: "medium",
			encodingMode: "fast",
			selectedMp4FrameRate: 24,
			exportVideoCodec: "hevc",
			exportEncoderPreference: "hardware",
			exportBitrateMode: "custom",
			exportBitrateMbps: 25,
		});
	});

	it("clamps custom bitrate to the 1-200 Mbps safety range", () => {
		expect(
			resolveMp4ExportSettings({
				...baseOptions,
				settings: { exportBitrateMode: "custom" },
				exportBitrateMbps: 500,
			}).exportBitrateMbps,
		).toBe(200);
		expect(
			resolveMp4ExportSettings({
				...baseOptions,
				exportBitrateMbps: -3,
			}).exportBitrateMbps,
		).toBe(1);
	});

	it("falls back from incomplete smoke settings to menu settings and editor defaults", () => {
		expect(
			resolveMp4ExportSettings({
				...baseOptions,
				smokeExportConfig: {
					enabled: true,
					quality: "good",
				},
				settings: {
					encodingMode: "quality",
				},
			}),
		).toEqual({
			quality: "good",
			encodingMode: "quality",
			selectedMp4FrameRate: 30,
			exportVideoCodec: "h264",
			exportEncoderPreference: "auto",
			exportBitrateMode: "auto",
			exportBitrateMbps: 20,
		});
	});
});
