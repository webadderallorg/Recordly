import { describe, expect, it } from "vitest";

import { resolveMp4ExportRouting } from "./mp4ExportRouting";

const baseOptions = {
	smokeExportConfig: {
		enabled: false,
		useNativeExport: false,
	},
	settings: {},
	exportPipelineModel: "modern" as const,
	exportBackendPreference: "breeze" as const,
	experimentalNvidiaCudaExport: false,
	nvidiaCudaExportAvailable: false,
};

describe("resolveMp4ExportRouting", () => {
	it("uses the modern native auto route for normal MP4 exports by default", () => {
		expect(resolveMp4ExportRouting(baseOptions)).toEqual({
			pipelineModel: "modern",
			useExperimentalNativeExport: true,
			useExperimentalNvidiaCudaExport: false,
			backendPreference: "auto",
		});
	});

	it("forces WebCodecs and disables native export for the legacy pipeline", () => {
		expect(
			resolveMp4ExportRouting({
				...baseOptions,
				settings: { pipelineModel: "legacy", backendPreference: "breeze" },
			}),
		).toEqual({
			pipelineModel: "legacy",
			useExperimentalNativeExport: false,
			useExperimentalNvidiaCudaExport: false,
			backendPreference: "webcodecs",
		});
	});

	it("keeps smoke exports on WebCodecs unless smoke native export is requested", () => {
		expect(
			resolveMp4ExportRouting({
				...baseOptions,
				smokeExportConfig: {
					enabled: true,
					useNativeExport: false,
				},
			}),
		).toEqual({
			pipelineModel: "modern",
			useExperimentalNativeExport: false,
			useExperimentalNvidiaCudaExport: false,
			backendPreference: "webcodecs",
		});

		expect(
			resolveMp4ExportRouting({
				...baseOptions,
				smokeExportConfig: {
					enabled: true,
					useNativeExport: true,
				},
			}),
		).toEqual({
			pipelineModel: "modern",
			useExperimentalNativeExport: true,
			useExperimentalNvidiaCudaExport: false,
			backendPreference: "breeze",
		});
	});

	it("only enables NVIDIA CUDA when native export is active and the device is available", () => {
		expect(
			resolveMp4ExportRouting({
				...baseOptions,
				experimentalNvidiaCudaExport: true,
				nvidiaCudaExportAvailable: true,
			}).useExperimentalNvidiaCudaExport,
		).toBe(true);

		expect(
			resolveMp4ExportRouting({
				...baseOptions,
				settings: { pipelineModel: "legacy" },
				experimentalNvidiaCudaExport: true,
				nvidiaCudaExportAvailable: true,
			}).useExperimentalNvidiaCudaExport,
		).toBe(false);

		expect(
			resolveMp4ExportRouting({
				...baseOptions,
				experimentalNvidiaCudaExport: true,
				nvidiaCudaExportAvailable: false,
			}).useExperimentalNvidiaCudaExport,
		).toBe(false);
	});
});
