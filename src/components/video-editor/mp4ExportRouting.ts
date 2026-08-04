import type {
	ExportBackendPreference,
	ExportEncoderPreference,
	ExportPipelineModel,
	ExportSettings,
	ExportVideoCodec,
} from "@/lib/exporter";
import type { SmokeExportConfig } from "./smokeExportConfig";

export type Mp4ExportRouting = {
	pipelineModel: ExportPipelineModel;
	useExperimentalNativeExport: boolean;
	useExperimentalNvidiaCudaExport: boolean;
	/** True when HEVC + Hardware makes the NVIDIA CUDA compositor mandatory. The
	 *  CUDA route is forced regardless of the persisted opt-in toggle and the
	 *  export hard-fails when the compositor cannot run. */
	nvidiaCudaCompositorRequired: boolean;
	backendPreference: ExportBackendPreference;
	needsNativeRawFrame: boolean;
};

export function resolveMp4ExportRouting({
	smokeExportConfig,
	settings,
	exportPipelineModel,
	exportBackendPreference,
	exportVideoCodec = "h264",
	exportEncoderPreference = "auto",
	experimentalNvidiaCudaExport,
}: {
	smokeExportConfig: Pick<
		SmokeExportConfig,
		"enabled" | "pipelineModel" | "useNativeExport" | "backendPreference"
	>;
	settings: Pick<ExportSettings, "pipelineModel" | "backendPreference">;
	exportPipelineModel: ExportPipelineModel;
	exportBackendPreference: ExportBackendPreference;
	exportVideoCodec: ExportVideoCodec;
	exportEncoderPreference: ExportEncoderPreference;
	experimentalNvidiaCudaExport: boolean;
	nvidiaCudaExportAvailable: boolean;
}): Mp4ExportRouting {
	// HEVC and any explicit encoder preference stay on the modern pipeline. HEVC
	// can use the native CUDA compositor for Auto/Hardware, with rawvideo reserved
	// for unavailable GPU routes and unsupported effects.
	const requiresModernCodecRoute =
		exportVideoCodec === "hevc" || exportEncoderPreference !== "auto";
	const pipelineModel = requiresModernCodecRoute
		? "modern"
		: smokeExportConfig.enabled
			? (smokeExportConfig.pipelineModel ?? "modern")
			: (settings.pipelineModel ?? exportPipelineModel);
	const useExperimentalNativeExport =
		pipelineModel === "modern" &&
		(smokeExportConfig.enabled ? smokeExportConfig.useNativeExport : true);
	const mayUseNativeGpuCompositor =
		exportEncoderPreference === "auto" ||
		(exportVideoCodec === "hevc" && exportEncoderPreference === "hardware");
	// HEVC + Hardware makes the NVIDIA CUDA compositor mandatory: the user's codec
	// and encoder choice IS the opt-in, so the CUDA route no longer depends on a
	// hidden experimental toggle. If the compositor cannot run (no helper, no
	// NVIDIA GPU, overlay preparation failure), the exporter hard-fails instead of
	// falling back to WebGPU/Breeze/raw or CPU.
	const nvidiaCudaCompositorRequired =
		exportVideoCodec === "hevc" && exportEncoderPreference === "hardware";
	// For non-mandatory routes the CUDA route stays driven by the user's persisted
	// opt-in state (which the capability hook already forces off when the
	// helper/GPU is unavailable). The runtime `native-static-layout-export`
	// attempt remains the authoritative capability check; gating on the async
	// `nvidiaCudaExportAvailable` probe here would race exports started before the
	// probe resolves and would skip a working route on a flaky Electron GPU-info
	// probe.
	const useExperimentalNvidiaCudaExport =
		useExperimentalNativeExport &&
		mayUseNativeGpuCompositor &&
		(nvidiaCudaCompositorRequired || experimentalNvidiaCudaExport);
	const canUseHevcNativeGpuCompositor =
		exportVideoCodec === "hevc" &&
		exportEncoderPreference !== "cpu" &&
		useExperimentalNvidiaCudaExport;
	const needsNativeRawFrame =
		exportVideoCodec === "hevc"
			? !canUseHevcNativeGpuCompositor
			: exportEncoderPreference !== "auto";
	const backendPreference =
		pipelineModel === "legacy"
			? "webcodecs"
			: smokeExportConfig.enabled
				? (smokeExportConfig.backendPreference ??
					(smokeExportConfig.useNativeExport ? "breeze" : "webcodecs"))
				: useExperimentalNativeExport
					? "auto"
					: (settings.backendPreference ?? exportBackendPreference);

	return {
		pipelineModel,
		useExperimentalNativeExport,
		useExperimentalNvidiaCudaExport,
		nvidiaCudaCompositorRequired,
		backendPreference,
		needsNativeRawFrame,
	};
}
