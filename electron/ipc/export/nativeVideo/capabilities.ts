import path from "node:path";
import { app } from "electron";
import { type NativeVideoExportAudioMode } from "../../nativeVideoExport";
import {
	DEFAULT_NATIVE_GPU_STALL_TIMEOUT_MS,
	DEFAULT_NVIDIA_CUDA_AUTO_STALL_TIMEOUT_MS,
	NATIVE_GPU_STALL_TIMEOUT_ENV,
	NVIDIA_CUDA_ALLOW_AUDIO_EXPORT_ENV,
	NVIDIA_CUDA_AUTO_STALL_TIMEOUT_ENV,
	NVIDIA_CUDA_EXPORT_ENV,
	NVIDIA_CUDA_FORCE_VIDEO_ONLY_ENV,
} from "./constants";
import {
	hasNvidiaGpuForCudaExportCandidate,
	probeNvidiaGpuForCudaExportCandidate,
} from "./hardware";
import { pathExists } from "./layout";
import { type NativeExportCapabilities, type NativeStaticLayoutExportOptions } from "./types";

export function getNativeBinPlatformArch() {
	return process.arch === "arm64" ? "win32-arm64" : "win32-x64";
}

export async function resolveExperimentalWindowsGpuExporterPath() {
	if (process.platform !== "win32") {
		return null;
	}

	const executableNames = ["recordly-gpu-export.exe", "gpu-export-probe.exe"];
	const candidates: string[] = [];
	const configuredPath = process.env.RECORDLY_WINDOWS_GPU_EXPORT_EXE;
	if (configuredPath) {
		candidates.push(configuredPath);
	}

	const nativeBinDir = path.join("electron", "native", "bin", getNativeBinPlatformArch());
	const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
	if (resourcesPath) {
		for (const executableName of executableNames) {
			candidates.push(
				path.join(resourcesPath, "app.asar.unpacked", nativeBinDir, executableName),
				path.join(resourcesPath, nativeBinDir, executableName),
			);
		}
	}

	for (const executableName of executableNames) {
		candidates.push(
			path.join(process.cwd(), nativeBinDir, executableName),
			path.join(
				app.getAppPath().replace(/app\.asar$/, "app.asar.unpacked"),
				nativeBinDir,
				executableName,
			),
			path.join(process.cwd(), ".tmp", "gpu-export-probe-build", "Release", executableName),
			path.join(
				process.cwd(),
				"electron",
				"native",
				"gpu-export-probe",
				"build",
				"Release",
				executableName,
			),
		);
	}

	for (const candidate of candidates) {
		if (await pathExists(candidate)) {
			return candidate;
		}
	}

	return null;
}

export function getNvidiaCudaAudioExportSkipReason(
	audioMode: NativeVideoExportAudioMode | undefined,
	options: { allowValidatedFallbackCandidate?: boolean } = {},
) {
	const resolvedAudioMode = audioMode ?? "none";
	if (resolvedAudioMode === "none") {
		return null;
	}
	if (process.env[NVIDIA_CUDA_ALLOW_AUDIO_EXPORT_ENV] === "1") {
		return null;
	}
	if (options.allowValidatedFallbackCandidate) {
		return null;
	}

	return `audio-mode:${resolvedAudioMode}`;
}

export function isExplicitNvidiaCudaExportEnabled() {
	return process.env[NVIDIA_CUDA_EXPORT_ENV] === "1";
}

export function isExplicitNvidiaCudaExportDisabled() {
	return process.env[NVIDIA_CUDA_EXPORT_ENV] === "0";
}

export function isUserOptedInNvidiaCudaExport(options: NativeStaticLayoutExportOptions) {
	return options.experimentalNvidiaCudaExport === true && !isExplicitNvidiaCudaExportDisabled();
}

export function isValidatedNvidiaCudaFallbackCandidate(options: NativeStaticLayoutExportOptions) {
	return isUserOptedInNvidiaCudaExport(options) && !isExplicitNvidiaCudaExportEnabled();
}

export function isNvidiaCudaForceVideoOnlyEnabled() {
	return process.env[NVIDIA_CUDA_FORCE_VIDEO_ONLY_ENV] === "1";
}

export function getNvidiaCudaAutoStallTimeoutMs(autoCandidateActive = false) {
	if (!autoCandidateActive && !isExplicitNvidiaCudaExportEnabled()) {
		return null;
	}

	const rawValue = process.env[NVIDIA_CUDA_AUTO_STALL_TIMEOUT_ENV]?.trim();
	if (rawValue === "0" || rawValue?.toLowerCase() === "off") {
		return null;
	}

	const parsed = Number(rawValue);
	if (Number.isFinite(parsed) && parsed > 0) {
		return Math.max(10_000, Math.round(parsed));
	}

	return DEFAULT_NVIDIA_CUDA_AUTO_STALL_TIMEOUT_MS;
}

export function getNativeGpuCompositorStallTimeoutMs() {
	const rawValue = process.env[NATIVE_GPU_STALL_TIMEOUT_ENV]?.trim();
	if (rawValue === "0" || rawValue?.toLowerCase() === "off") {
		return null;
	}

	const parsed = Number(rawValue);
	if (Number.isFinite(parsed) && parsed > 0) {
		return Math.max(10_000, Math.round(parsed));
	}

	return DEFAULT_NATIVE_GPU_STALL_TIMEOUT_MS;
}

export async function getExperimentalNvidiaCudaExportSkipReason(
	options: NativeStaticLayoutExportOptions,
) {
	if (process.platform !== "win32") {
		return "not-windows";
	}
	if (isExplicitNvidiaCudaExportDisabled()) {
		return "env-disabled";
	}
	const explicitCuda = isExplicitNvidiaCudaExportEnabled();
	const userOptIn = isUserOptedInNvidiaCudaExport(options);
	if (!explicitCuda && !userOptIn) {
		return "env-disabled";
	}
	if (!options.experimentalWindowsGpuCompositor) {
		return "windows-gpu-compositor-disabled";
	}

	if (userOptIn) {
		if (!(await resolveExperimentalNvidiaCudaExportScriptPath())) {
			return "cuda-wrapper-unavailable";
		}
		if (!(await hasNvidiaGpuForCudaExportCandidate())) {
			return "nvidia-gpu-unavailable";
		}
	}

	return getNvidiaCudaAudioExportSkipReason(options.audioOptions?.audioMode, {
		allowValidatedFallbackCandidate:
			isValidatedNvidiaCudaFallbackCandidate(options) || isNvidiaCudaForceVideoOnlyEnabled(),
	});
}

export async function getNativeExportCapabilities(): Promise<NativeExportCapabilities> {
	if (process.platform !== "win32") {
		return {
			platform: process.platform,
			nvidiaCuda: {
				available: false,
				skipReason: "not-windows",
				hasNvidiaGpu: null,
				hasWrapper: false,
				explicitEnabled: isExplicitNvidiaCudaExportEnabled(),
				explicitDisabled: isExplicitNvidiaCudaExportDisabled(),
				userOptInRequired: true,
			},
		};
	}

	const explicitEnabled = isExplicitNvidiaCudaExportEnabled();
	const explicitDisabled = isExplicitNvidiaCudaExportDisabled();
	const wrapperPath = await resolveExperimentalNvidiaCudaExportScriptPath();
	const hasNvidiaGpu = await probeNvidiaGpuForCudaExportCandidate();
	const skipReason = explicitDisabled
		? "env-disabled"
		: !wrapperPath
			? "cuda-wrapper-unavailable"
			: hasNvidiaGpu === false
				? "nvidia-gpu-unavailable"
				: hasNvidiaGpu === null
					? "nvidia-gpu-probe-unavailable"
					: null;

	return {
		platform: process.platform,
		nvidiaCuda: {
			available: skipReason === null,
			skipReason,
			hasNvidiaGpu,
			hasWrapper: Boolean(wrapperPath),
			explicitEnabled,
			explicitDisabled,
			userOptInRequired: !explicitEnabled,
		},
	};
}

export async function resolveExperimentalNvidiaCudaExportScriptPath() {
	if (process.platform !== "win32") {
		return null;
	}

	const candidates: string[] = [];
	const configuredPath = process.env.RECORDLY_NVIDIA_CUDA_EXPORT_SCRIPT;
	if (configuredPath) {
		candidates.push(configuredPath);
	}
	const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
	if (resourcesPath) {
		candidates.push(
			path.join(
				resourcesPath,
				"app.asar.unpacked",
				"electron",
				"native",
				"nvidia-cuda-compositor",
				"run-mp4-pipeline.mjs",
			),
		);
	}
	candidates.push(
		path.join(
			process.cwd(),
			"electron",
			"native",
			"nvidia-cuda-compositor",
			"run-mp4-pipeline.mjs",
		),
		path.join(
			app.getAppPath().replace(/app\.asar$/, "app.asar.unpacked"),
			"electron",
			"native",
			"nvidia-cuda-compositor",
			"run-mp4-pipeline.mjs",
		),
		path.join(
			app.getAppPath(),
			"electron",
			"native",
			"nvidia-cuda-compositor",
			"run-mp4-pipeline.mjs",
		),
		path.join(process.cwd(), ".tmp", "nvdec-nvenc-probe", "run-mp4-pipeline.mjs"),
		path.join(app.getAppPath(), ".tmp", "nvdec-nvenc-probe", "run-mp4-pipeline.mjs"),
	);

	for (const candidate of candidates) {
		if (await pathExists(candidate)) {
			return candidate;
		}
	}

	return null;
}

export function resolveExperimentalNvidiaCudaNodeCommand() {
	const configuredNodePath = process.env.RECORDLY_NVIDIA_CUDA_NODE_EXE;
	if (configuredNodePath) {
		return {
			command: configuredNodePath,
			env: {},
		};
	}

	return {
		command: process.execPath,
		env: {
			ELECTRON_RUN_AS_NODE: "1",
		},
	};
}
