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
};

describe("resolveMp4ExportSettings", () => {
	it("uses editor defaults when neither menu settings nor smoke settings override them", () => {
		expect(resolveMp4ExportSettings(baseOptions)).toEqual({
			quality: "high",
			encodingMode: "balanced",
			selectedMp4FrameRate: 30,
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
				},
			}),
		).toEqual({
			quality: "source",
			encodingMode: "quality",
			selectedMp4FrameRate: 60,
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
				},
				settings: {
					quality: "source",
					encodingMode: "quality",
					mp4FrameRate: 60,
				},
			}),
		).toEqual({
			quality: "medium",
			encodingMode: "fast",
			selectedMp4FrameRate: 24,
		});
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
		});
	});
});
