import type { NativeVideoExportAudioMode } from "../nativeVideoExport";

export type NativeStaticLayoutRoute =
	| "nvidia-cuda-compositor"
	| "windows-d3d11-compositor"
	| "ffmpeg-static-layout";

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
	selectedRoute: NativeStaticLayoutRoute;
	decisions: NativeStaticLayoutRouteDecision[];
	cuda: NvidiaCudaExportCapabilityProbe;
	d3d11: WindowsD3D11ExportCapabilityProbe;
	source: NativeStaticLayoutRouteSource;
}

export function planNativeStaticLayoutRoutes(options: {
	cuda: NvidiaCudaExportCapabilityProbe;
	d3d11: WindowsD3D11ExportCapabilityProbe;
	source: NativeStaticLayoutRouteSource;
}): NativeStaticLayoutRoutePlan {
	const { cuda, d3d11, source } = options;
	const decisions: NativeStaticLayoutRouteDecision[] = [];

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
			selectedRoute: "nvidia-cuda-compositor",
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
			selectedRoute: "windows-d3d11-compositor",
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
		selectedRoute: "ffmpeg-static-layout",
		decisions,
		cuda,
		d3d11,
		source,
	};
}
