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
	exportVideoCodec: "h264" as const,
	exportEncoderPreference: "auto" as const,
	experimentalNvidiaCudaExport: false,
	nvidiaCudaExportAvailable: false,
};

describe("resolveMp4ExportRouting", () => {
	it("uses the modern native auto route for normal MP4 exports by default", () => {
		expect(resolveMp4ExportRouting(baseOptions)).toEqual({
			pipelineModel: "modern",
			useExperimentalNativeExport: true,
			useExperimentalNvidiaCudaExport: false,
			nvidiaCudaCompositorRequired: false,
			backendPreference: "auto",
			needsNativeRawFrame: false,
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
			nvidiaCudaCompositorRequired: false,
			backendPreference: "webcodecs",
			needsNativeRawFrame: false,
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
			nvidiaCudaCompositorRequired: false,
			backendPreference: "webcodecs",
			needsNativeRawFrame: false,
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
			nvidiaCudaCompositorRequired: false,
			backendPreference: "breeze",
			needsNativeRawFrame: false,
		});
	});

	it("enables NVIDIA CUDA from the persisted opt-in without racing the async GPU probe", () => {
		// The runtime static-layout attempt is the authoritative capability check;
		// a stale/async availability probe must not disable a working route (the
		// opt-in hook already forces the toggle off when the helper/GPU is truly
		// unavailable).
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
				experimentalNvidiaCudaExport: true,
				nvidiaCudaExportAvailable: false,
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
				experimentalNvidiaCudaExport: false,
				nvidiaCudaExportAvailable: true,
			}).useExperimentalNvidiaCudaExport,
		).toBe(false);
	});

	it("forces the modern native pipeline for HEVC output", () => {
		const result = resolveMp4ExportRouting({
			...baseOptions,
			exportVideoCodec: "hevc",
			settings: { pipelineModel: "legacy" },
		});
		expect(result.needsNativeRawFrame).toBe(true);
		expect(result.pipelineModel).toBe("modern");
		expect(result.useExperimentalNativeExport).toBe(true);
		expect(result.backendPreference).toBe("auto");
	});

	it("selects the HEVC Auto GPU candidate without forcing raw dimensions", () => {
		const result = resolveMp4ExportRouting({
			...baseOptions,
			exportVideoCodec: "hevc",
			experimentalNvidiaCudaExport: true,
			nvidiaCudaExportAvailable: true,
		});

		expect(result).toMatchObject({
			pipelineModel: "modern",
			useExperimentalNativeExport: true,
			useExperimentalNvidiaCudaExport: true,
			backendPreference: "auto",
			needsNativeRawFrame: false,
		});
	});

	it("selects the HEVC Hardware GPU candidate without allowing CPU routing", () => {
		const result = resolveMp4ExportRouting({
			...baseOptions,
			exportVideoCodec: "hevc",
			exportEncoderPreference: "hardware",
			experimentalNvidiaCudaExport: true,
			nvidiaCudaExportAvailable: true,
		});

		expect(result.useExperimentalNvidiaCudaExport).toBe(true);
		expect(result.needsNativeRawFrame).toBe(false);
		expect(result.pipelineModel).toBe("modern");
	});

	it("keeps HEVC CPU on rawvideo and out of the GPU compositor", () => {
		const result = resolveMp4ExportRouting({
			...baseOptions,
			exportVideoCodec: "hevc",
			exportEncoderPreference: "cpu",
			experimentalNvidiaCudaExport: true,
			nvidiaCudaExportAvailable: true,
		});

		expect(result.useExperimentalNvidiaCudaExport).toBe(false);
		expect(result.needsNativeRawFrame).toBe(true);
	});

	it("forces the modern native pipeline when the encoder preference is cpu", () => {
		const result = resolveMp4ExportRouting({
			...baseOptions,
			exportVideoCodec: "h264",
			exportEncoderPreference: "cpu",
		});
		expect(result.needsNativeRawFrame).toBe(true);
		expect(result.pipelineModel).toBe("modern");
		expect(result.useExperimentalNativeExport).toBe(true);
		expect(result.backendPreference).toBe("auto");
	});

	it("needs a native raw frame when the encoder preference is hardware", () => {
		const result = resolveMp4ExportRouting({
			...baseOptions,
			exportVideoCodec: "h264",
			exportEncoderPreference: "hardware",
		});
		expect(result.needsNativeRawFrame).toBe(true);
		expect(result.pipelineModel).toBe("modern");
		expect(result.useExperimentalNativeExport).toBe(true);
		expect(result.backendPreference).toBe("auto");
	});

	it("keeps the existing legacy/auto route for H.264 with auto encoder preference", () => {
		const legacy = resolveMp4ExportRouting({
			...baseOptions,
			settings: { pipelineModel: "legacy", backendPreference: "breeze" },
		});
		expect(legacy).toEqual({
			pipelineModel: "legacy",
			useExperimentalNativeExport: false,
			useExperimentalNvidiaCudaExport: false,
			nvidiaCudaCompositorRequired: false,
			backendPreference: "webcodecs",
			needsNativeRawFrame: false,
		});
		expect(legacy.needsNativeRawFrame).toBe(false);
	});

	it("forces the NVIDIA CUDA compositor for HEVC Hardware even when the opt-in toggle is off", () => {
		// The user's HEVC + Hardware selection IS the opt-in: the CUDA compositor is
		// mandatory and must never depend on a hidden experimental flag.
		const result = resolveMp4ExportRouting({
			...baseOptions,
			exportVideoCodec: "hevc",
			exportEncoderPreference: "hardware",
			experimentalNvidiaCudaExport: false,
			nvidiaCudaExportAvailable: true,
		});

		expect(result.nvidiaCudaCompositorRequired).toBe(true);
		expect(result.useExperimentalNvidiaCudaExport).toBe(true);
		expect(result.needsNativeRawFrame).toBe(false);
		expect(result.pipelineModel).toBe("modern");
		expect(result.backendPreference).toBe("auto");
	});

	it("keeps HEVC Hardware on the mandatory CUDA route even when the async capability probe is stale", () => {
		const result = resolveMp4ExportRouting({
			...baseOptions,
			exportVideoCodec: "hevc",
			exportEncoderPreference: "hardware",
			experimentalNvidiaCudaExport: false,
			nvidiaCudaExportAvailable: false,
		});

		expect(result.nvidiaCudaCompositorRequired).toBe(true);
		expect(result.useExperimentalNvidiaCudaExport).toBe(true);
		expect(result.needsNativeRawFrame).toBe(false);
	});

	it("does not mark H.264, HEVC Auto, or HEVC CPU as mandatory CUDA routes", () => {
		const h264Auto = resolveMp4ExportRouting({
			...baseOptions,
			exportVideoCodec: "h264",
			exportEncoderPreference: "auto",
			experimentalNvidiaCudaExport: true,
			nvidiaCudaExportAvailable: true,
		});
		expect(h264Auto.nvidiaCudaCompositorRequired).toBe(false);
		expect(h264Auto.useExperimentalNvidiaCudaExport).toBe(true);
		expect(h264Auto.needsNativeRawFrame).toBe(false);

		const hevcAuto = resolveMp4ExportRouting({
			...baseOptions,
			exportVideoCodec: "hevc",
			exportEncoderPreference: "auto",
			experimentalNvidiaCudaExport: true,
			nvidiaCudaExportAvailable: true,
		});
		expect(hevcAuto.nvidiaCudaCompositorRequired).toBe(false);
		expect(hevcAuto.useExperimentalNvidiaCudaExport).toBe(true);
		expect(hevcAuto.needsNativeRawFrame).toBe(false);

		const hevcCpu = resolveMp4ExportRouting({
			...baseOptions,
			exportVideoCodec: "hevc",
			exportEncoderPreference: "cpu",
			experimentalNvidiaCudaExport: true,
			nvidiaCudaExportAvailable: true,
		});
		expect(hevcCpu.nvidiaCudaCompositorRequired).toBe(false);
		expect(hevcCpu.useExperimentalNvidiaCudaExport).toBe(false);
		expect(hevcCpu.needsNativeRawFrame).toBe(true);
	});

	it("keeps HEVC Auto on the opt-in toggle: CUDA only when the user enables it", () => {
		const toggledOff = resolveMp4ExportRouting({
			...baseOptions,
			exportVideoCodec: "hevc",
			exportEncoderPreference: "auto",
			experimentalNvidiaCudaExport: false,
			nvidiaCudaExportAvailable: true,
		});
		expect(toggledOff.useExperimentalNvidiaCudaExport).toBe(false);
		expect(toggledOff.needsNativeRawFrame).toBe(true);
	});
});
