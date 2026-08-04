import type {
	ExportEncoderPreference,
	ExportVideoCodec,
	NativeVideoExportAudioMode,
} from "../nativeVideoExport";

export type NativeStaticLayoutRoute =
	| "nvidia-cuda-compositor"
	| "windows-d3d11-compositor"
	| "ffmpeg-static-layout";
export type NativeStaticLayoutFallbackRoute = "native-rawvideo";

export interface NativeStaticLayoutRouteDecision {
	route: NativeStaticLayoutRoute;
	status: "selected" | "fallback" | "rejected";
	reasons: string[];
}

export interface NvidiaCudaExportCapabilityProbe {
	platform: NodeJS.Platform;
	appPackaged: boolean;
	explicitEnabled: boolean;
	explicitDisabled: boolean;
	packagedAutoCandidateEnabled: boolean;
	packagedAutoCandidateActive: boolean;
	windowsGpuCompositorEnabled: boolean;
	wrapperPath: string | null;
	hasNvidiaGpu: boolean | null;
	audioMode: NativeVideoExportAudioMode;
	audioSkipReason: string | null;
	stallTimeoutMs: number | null;
	skipReason: string | null;
}

export interface WindowsD3D11ExportCapabilityProbe {
	platform: NodeJS.Platform;
	windowsGpuCompositorEnabled: boolean;
	helperPath: string | null;
	adapterIndexOverride: number | null;
	preferHighPerformanceAdapter: boolean;
	nvencSdkRequested: boolean;
	skipReason: string | null;
}

export interface NativeStaticLayoutRouteSource {
	inputCodec: string;
	proxyCodec?: string;
	proxyCreated: boolean;
}

export interface NativeStaticLayoutRoutePlan {
	videoCodec: ExportVideoCodec;
	encoderPreference: ExportEncoderPreference;
	selectedRoute: NativeStaticLayoutRoute | null;
	fallbackRoute: NativeStaticLayoutFallbackRoute | null;
	fallbackReason: string | null;
	decisions: NativeStaticLayoutRouteDecision[];
	cuda: NvidiaCudaExportCapabilityProbe;
	d3d11: WindowsD3D11ExportCapabilityProbe;
	source: NativeStaticLayoutRouteSource;
}

function createRawVideoFallbackPlan(options: {
	videoCodec: ExportVideoCodec;
	encoderPreference: ExportEncoderPreference;
	cuda: NvidiaCudaExportCapabilityProbe;
	d3d11: WindowsD3D11ExportCapabilityProbe;
	source: NativeStaticLayoutRouteSource;
	reason: string;
	cudaReason: string;
}) {
	const { videoCodec, encoderPreference, cuda, d3d11, source } = options;
	return {
		videoCodec,
		encoderPreference,
		selectedRoute: null,
		fallbackRoute: "native-rawvideo" as const,
		fallbackReason: options.reason,
		decisions: [
			{
				route: "nvidia-cuda-compositor" as const,
				status: "rejected" as const,
				reasons: [options.cudaReason],
			},
			{
				route: "windows-d3d11-compositor" as const,
				status: "rejected" as const,
				reasons: [
					videoCodec === "hevc" ? "hevc-requires-nvidia-cuda-compositor" : options.reason,
				],
			},
			{
				route: "ffmpeg-static-layout" as const,
				status: "rejected" as const,
				reasons: [
					videoCodec === "hevc" ? "hevc-requires-nvidia-cuda-compositor" : options.reason,
				],
			},
		],
		cuda,
		d3d11,
		source,
	} satisfies NativeStaticLayoutRoutePlan;
}

export function planNativeStaticLayoutRoutes(options: {
	videoCodec?: ExportVideoCodec;
	encoderPreference?: ExportEncoderPreference;
	cuda: NvidiaCudaExportCapabilityProbe;
	d3d11: WindowsD3D11ExportCapabilityProbe;
	source: NativeStaticLayoutRouteSource;
}): NativeStaticLayoutRoutePlan {
	const videoCodec = options.videoCodec ?? "h264";
	const encoderPreference = options.encoderPreference ?? "auto";
	const { cuda, d3d11, source } = options;
	const decisions: NativeStaticLayoutRouteDecision[] = [];

	if (encoderPreference === "cpu") {
		return createRawVideoFallbackPlan({
			videoCodec,
			encoderPreference,
			cuda,
			d3d11,
			source,
			reason: "encoder-preference-cpu-requires-native-rawvideo",
			cudaReason: "encoder-preference-cpu-never-enters-gpu-compositor",
		});
	}

	if (videoCodec === "hevc") {
		if (!cuda.skipReason) {
			decisions.push({
				route: "nvidia-cuda-compositor",
				status: "selected",
				reasons: ["cuda-wrapper-and-nvidia-gpu-available-for-hevc"],
			});
			decisions.push({
				route: "windows-d3d11-compositor",
				status: "rejected",
				reasons: ["hevc-requires-nvidia-cuda-compositor"],
			});
			decisions.push({
				route: "ffmpeg-static-layout",
				status: "rejected",
				reasons: ["hevc-requires-nvidia-cuda-compositor"],
			});
			return {
				videoCodec,
				encoderPreference,
				selectedRoute: "nvidia-cuda-compositor",
				fallbackRoute: null,
				fallbackReason: null,
				decisions,
				cuda,
				d3d11,
				source,
			};
		}

		return createRawVideoFallbackPlan({
			videoCodec,
			encoderPreference,
			cuda,
			d3d11,
			source,
			reason:
				encoderPreference === "hardware"
					? `hevc-hardware-route-unavailable:${cuda.skipReason}`
					: `hevc-cuda-unavailable:${cuda.skipReason}`,
			cudaReason: cuda.skipReason,
		});
	}

	if (encoderPreference === "hardware") {
		return createRawVideoFallbackPlan({
			videoCodec,
			encoderPreference,
			cuda,
			d3d11,
			source,
			reason: "encoder-preference-hardware-requires-native-rawvideo",
			cudaReason: "explicit-hardware-preference-requires-native-rawvideo",
		});
	}

	if (!cuda.skipReason) {
		decisions.push({
			route: "nvidia-cuda-compositor",
			status: "selected",
			reasons: ["cuda-wrapper-and-nvidia-gpu-available"],
		});
		decisions.push({
			route: "windows-d3d11-compositor",
			status: d3d11.skipReason ? "rejected" : "fallback",
			reasons: d3d11.skipReason
				? [d3d11.skipReason]
				: ["documented-fallback-if-cuda-runtime-fails"],
		});
		decisions.push({
			route: "ffmpeg-static-layout",
			status: "fallback",
			reasons: ["native-gpu-runtime-fallback"],
		});
		return {
			videoCodec,
			encoderPreference,
			selectedRoute: "nvidia-cuda-compositor",
			fallbackRoute: null,
			fallbackReason: null,
			decisions,
			cuda,
			d3d11,
			source,
		};
	}

	decisions.push({
		route: "nvidia-cuda-compositor",
		status: "rejected",
		reasons: [cuda.skipReason],
	});

	if (!d3d11.skipReason) {
		decisions.push({
			route: "windows-d3d11-compositor",
			status: "selected",
			reasons: [`documented-fallback-after-cuda-skip:${cuda.skipReason}`],
		});
		decisions.push({
			route: "ffmpeg-static-layout",
			status: "fallback",
			reasons: ["windows-d3d11-runtime-fallback"],
		});
		return {
			videoCodec,
			encoderPreference,
			selectedRoute: "windows-d3d11-compositor",
			fallbackRoute: null,
			fallbackReason: null,
			decisions,
			cuda,
			d3d11,
			source,
		};
	}

	decisions.push({
		route: "windows-d3d11-compositor",
		status: "rejected",
		reasons: [d3d11.skipReason],
	});
	decisions.push({
		route: "ffmpeg-static-layout",
		status: "selected",
		reasons: ["native-gpu-routes-unavailable"],
	});
	return {
		videoCodec,
		encoderPreference,
		selectedRoute: "ffmpeg-static-layout",
		fallbackRoute: null,
		fallbackReason: null,
		decisions,
		cuda,
		d3d11,
		source,
	};
}
