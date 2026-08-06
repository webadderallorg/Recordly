import { describe, expect, it } from "vitest";
import {
	type NativeStaticLayoutRouteSource,
	type NvidiaCudaExportCapabilityProbe,
	planNativeStaticLayoutRoutes,
	type WindowsD3D11ExportCapabilityProbe,
} from "./nativeStaticLayoutRoutePlan";

const source: NativeStaticLayoutRouteSource = {
	inputCodec: "h264",
	proxyCodec: "h264",
	proxyCreated: false,
};

const cudaProbe: NvidiaCudaExportCapabilityProbe = {
	platform: "win32",
	appPackaged: true,
	explicitEnabled: false,
	explicitDisabled: false,
	packagedAutoCandidateEnabled: true,
	packagedAutoCandidateActive: true,
	windowsGpuCompositorEnabled: true,
	wrapperPath: "C:\\Recordly\\run-mp4-pipeline.mjs",
	hasNvidiaGpu: true,
	audioMode: "copy-source",
	audioSkipReason: null,
	stallTimeoutMs: 120_000,
	skipReason: null,
};

const d3d11Probe: WindowsD3D11ExportCapabilityProbe = {
	platform: "win32",
	windowsGpuCompositorEnabled: true,
	helperPath: "C:\\Recordly\\recordly-gpu-export.exe",
	adapterIndexOverride: null,
	preferHighPerformanceAdapter: true,
	nvencSdkRequested: false,
	skipReason: null,
};

describe("planNativeStaticLayoutRoutes", () => {
	it("selects CUDA first and records D3D11 plus FFmpeg fallbacks", () => {
		expect(
			planNativeStaticLayoutRoutes({
				cuda: cudaProbe,
				d3d11: d3d11Probe,
				source,
			}),
		).toMatchObject({
			selectedRoute: "nvidia-cuda-compositor",
			decisions: [
				{
					route: "nvidia-cuda-compositor",
					status: "selected",
					reasons: ["cuda-wrapper-and-nvidia-gpu-available"],
				},
				{
					route: "windows-d3d11-compositor",
					status: "fallback",
					reasons: ["documented-fallback-if-cuda-runtime-fails"],
				},
				{
					route: "ffmpeg-static-layout",
					status: "fallback",
					reasons: ["native-gpu-runtime-fallback"],
				},
			],
			cuda: cudaProbe,
			d3d11: d3d11Probe,
			source,
		});
	});

	it("selects D3D11 when CUDA is unavailable", () => {
		const cuda = {
			...cudaProbe,
			hasNvidiaGpu: false,
			skipReason: "nvidia-gpu-unavailable",
		} satisfies NvidiaCudaExportCapabilityProbe;

		expect(
			planNativeStaticLayoutRoutes({
				cuda,
				d3d11: d3d11Probe,
				source,
			}),
		).toMatchObject({
			selectedRoute: "windows-d3d11-compositor",
			decisions: [
				{
					route: "nvidia-cuda-compositor",
					status: "rejected",
					reasons: ["nvidia-gpu-unavailable"],
				},
				{
					route: "windows-d3d11-compositor",
					status: "selected",
					reasons: ["documented-fallback-after-cuda-skip:nvidia-gpu-unavailable"],
				},
				{
					route: "ffmpeg-static-layout",
					status: "fallback",
					reasons: ["windows-d3d11-runtime-fallback"],
				},
			],
		});
	});

	it("selects FFmpeg when both native GPU routes are unavailable", () => {
		const cuda = {
			...cudaProbe,
			wrapperPath: null,
			skipReason: "cuda-wrapper-unavailable",
		} satisfies NvidiaCudaExportCapabilityProbe;
		const d3d11 = {
			...d3d11Probe,
			helperPath: null,
			skipReason: "windows-gpu-helper-unavailable",
		} satisfies WindowsD3D11ExportCapabilityProbe;

		expect(
			planNativeStaticLayoutRoutes({
				cuda,
				d3d11,
				source,
			}),
		).toMatchObject({
			selectedRoute: "ffmpeg-static-layout",
			decisions: [
				{
					route: "nvidia-cuda-compositor",
					status: "rejected",
					reasons: ["cuda-wrapper-unavailable"],
				},
				{
					route: "windows-d3d11-compositor",
					status: "rejected",
					reasons: ["windows-gpu-helper-unavailable"],
				},
				{
					route: "ffmpeg-static-layout",
					status: "selected",
					reasons: ["native-gpu-routes-unavailable"],
				},
			],
			cuda,
			d3d11,
			source,
		});
	});

	it("routes HEVC only through NVIDIA CUDA", () => {
		const plan = planNativeStaticLayoutRoutes({
			videoCodec: "hevc",
			encoderPreference: "auto",
			cuda: cudaProbe,
			d3d11: d3d11Probe,
			source,
		});

		expect(plan.selectedRoute).toBe("nvidia-cuda-compositor");
		expect(plan.videoCodec).toBe("hevc");
		expect(plan.encoderPreference).toBe("auto");
		expect(plan.decisions).toEqual(
			expect.arrayContaining([
				{
					route: "windows-d3d11-compositor",
					status: "rejected",
					reasons: ["hevc-requires-nvidia-cuda-compositor"],
				},
				{
					route: "ffmpeg-static-layout",
					status: "rejected",
					reasons: ["hevc-requires-nvidia-cuda-compositor"],
				},
			]),
		);
	});

	it("hard-fails when HEVC CUDA is unavailable and Hardware is strict", () => {
		const plan = planNativeStaticLayoutRoutes({
			videoCodec: "hevc",
			encoderPreference: "hardware",
			cuda: { ...cudaProbe, skipReason: "nvidia-gpu-unavailable" },
			d3d11: d3d11Probe,
			source,
		});

		expect(plan.selectedRoute).toBeNull();
		expect(plan.fallbackRoute).toBe("hard-fail");
		expect(plan.noCpuFallback).toBe(true);
		expect(plan.fallbackReason).toBe("hevc-hardware-route-unavailable:nvidia-gpu-unavailable");
		expect(plan.decisions).toEqual(
			expect.arrayContaining([
				{
					route: "nvidia-cuda-compositor",
					status: "rejected",
					reasons: ["nvidia-gpu-unavailable"],
				},
				{
					route: "windows-d3d11-compositor",
					status: "rejected",
					reasons: ["hevc-requires-nvidia-cuda-compositor"],
				},
				{
					route: "ffmpeg-static-layout",
					status: "rejected",
					reasons: ["hevc-requires-nvidia-cuda-compositor"],
				},
			]),
		);
	});

	it("keeps HEVC Auto rawvideo fallback non-strict", () => {
		const plan = planNativeStaticLayoutRoutes({
			videoCodec: "hevc",
			encoderPreference: "auto",
			cuda: { ...cudaProbe, skipReason: "nvidia-gpu-unavailable" },
			d3d11: d3d11Probe,
			source,
		});

		expect(plan.selectedRoute).toBeNull();
		expect(plan.fallbackRoute).toBe("native-rawvideo");
		expect(plan.noCpuFallback).toBe(false);
		expect(plan.fallbackReason).toBe("hevc-cuda-unavailable:nvidia-gpu-unavailable");
	});

	it("keeps CPU preference out of every GPU route", () => {
		const plan = planNativeStaticLayoutRoutes({
			videoCodec: "h264",
			encoderPreference: "cpu",
			cuda: cudaProbe,
			d3d11: d3d11Probe,
			source,
		});

		expect(plan.selectedRoute).toBeNull();
		expect(plan.fallbackRoute).toBe("native-rawvideo");
		expect(plan.fallbackReason).toBe("encoder-preference-cpu-requires-native-rawvideo");
		expect(plan.decisions.every((decision) => decision.status === "rejected")).toBe(true);
	});

	it("preserves proxy source metadata for route diagnostics", () => {
		const proxiedSource = {
			inputCodec: "vp9",
			proxyCodec: "h264",
			proxyCreated: true,
		};

		expect(
			planNativeStaticLayoutRoutes({
				cuda: cudaProbe,
				d3d11: d3d11Probe,
				source: proxiedSource,
			}).source,
		).toEqual(proxiedSource);
	});
});
