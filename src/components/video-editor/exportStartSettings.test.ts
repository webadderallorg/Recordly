import { describe, expect, it } from "vitest";
import { resolveExportStartSettings } from "./exportStartSettings";

const baseOptions = {
	sourceWidth: 1920,
	sourceHeight: 1080,
	exportFormat: "mp4" as const,
	includeCaptionSidecar: true,
	exportEncodingMode: "balanced" as const,
	exportQuality: "good" as const,
	mp4FrameRate: 30 as const,
	exportBackendPreference: "auto" as const,
	exportPipelineModel: "modern" as const,
	exportVideoCodec: "h264" as const,
	exportEncoderPreference: "auto" as const,
	exportBitrateMode: "auto" as const,
	exportBitrateMbps: 20,
	gifFrameRate: 20 as const,
	gifLoop: true,
	gifSizePreset: "medium" as const,
};

describe("resolveExportStartSettings", () => {
	it("preserves MP4 dropdown settings", () => {
		expect(resolveExportStartSettings(baseOptions)).toEqual({
			format: "mp4",
			includeCaptionSidecar: true,
			encodingMode: "balanced",
			mp4FrameRate: 30,
			backendPreference: "auto",
			pipelineModel: "modern",
			exportVideoCodec: "h264",
			exportEncoderPreference: "auto",
			exportBitrateMode: "auto",
			exportBitrateMbps: 20,
			quality: "good",
			gifConfig: undefined,
		});
	});

	it("carries MP4-only codec/encoder/bitrate fields for MP4", () => {
		expect(
			resolveExportStartSettings({
				...baseOptions,
				exportVideoCodec: "hevc",
				exportEncoderPreference: "cpu",
				exportBitrateMode: "custom",
				exportBitrateMbps: 12.5,
			}),
		).toMatchObject({
			format: "mp4",
			exportVideoCodec: "hevc",
			exportEncoderPreference: "cpu",
			exportBitrateMode: "custom",
			exportBitrateMbps: 12.5,
		});
	});

	it("omits MP4-only fields and resolves GIF dimensions for GIF exports", () => {
		expect(
			resolveExportStartSettings({
				...baseOptions,
				sourceWidth: 2560,
				sourceHeight: 1440,
				exportFormat: "gif",
				exportVideoCodec: "hevc",
				exportEncoderPreference: "cpu",
				exportBitrateMode: "custom",
				exportBitrateMbps: 40,
				gifFrameRate: 15,
				gifLoop: false,
				gifSizePreset: "medium",
			}),
		).toEqual({
			format: "gif",
			includeCaptionSidecar: false,
			encodingMode: undefined,
			mp4FrameRate: undefined,
			backendPreference: undefined,
			pipelineModel: undefined,
			exportVideoCodec: undefined,
			exportEncoderPreference: undefined,
			exportBitrateMode: undefined,
			exportBitrateMbps: undefined,
			quality: undefined,
			gifConfig: {
				frameRate: 15,
				loop: false,
				sizePreset: "medium",
				width: 1280,
				height: 720,
			},
		});
	});

	it("keeps original GIF dimensions when the original preset is selected", () => {
		expect(
			resolveExportStartSettings({
				...baseOptions,
				sourceWidth: 1234,
				sourceHeight: 678,
				exportFormat: "gif",
				gifSizePreset: "original",
			}).gifConfig,
		).toMatchObject({
			sizePreset: "original",
			width: 1234,
			height: 678,
		});
	});
});
