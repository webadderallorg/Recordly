import os from "node:os";
import { app } from "electron";
import { NVIDIA_PCI_VENDOR_ID } from "./constants";
import {
	type ElectronGpuDeviceLike,
	type ElectronGpuInfoLike,
	type ExportHardwareInfo,
} from "./types";

export function isNvidiaVendorId(value: unknown) {
	if (typeof value === "number") {
		return value === NVIDIA_PCI_VENDOR_ID;
	}
	if (typeof value !== "string") {
		return false;
	}

	const normalized = value.trim().toLowerCase();
	if (normalized.length === 0) {
		return false;
	}
	const parsed = normalized.startsWith("0x")
		? Number.parseInt(normalized.slice(2), 16)
		: Number.parseInt(normalized, 10);

	return Number.isFinite(parsed) && parsed === NVIDIA_PCI_VENDOR_ID;
}

export function includesNvidiaGpuName(value: unknown) {
	return typeof value === "string" && /\bnvidia\b/i.test(value);
}

export function isNvidiaGpuDevice(device: unknown) {
	if (!device || typeof device !== "object") {
		return false;
	}

	const gpuDevice = device as ElectronGpuDeviceLike;
	return (
		isNvidiaVendorId(gpuDevice.vendorId) ||
		includesNvidiaGpuName(gpuDevice.vendorString) ||
		includesNvidiaGpuName(gpuDevice.deviceString)
	);
}

export function hasNvidiaGpuDeviceInGpuInfo(gpuInfo: unknown) {
	if (!gpuInfo || typeof gpuInfo !== "object") {
		return false;
	}

	const devices = (gpuInfo as ElectronGpuInfoLike).gpuDevice;
	return Array.isArray(devices) && devices.some(isNvidiaGpuDevice);
}

export function getGpuVendorLabel(device: ElectronGpuDeviceLike): string | null {
	if (device.vendorString?.trim()) {
		return device.vendorString.trim();
	}

	const rawVendorId = device.vendorId;
	const vendorId =
		typeof rawVendorId === "number"
			? rawVendorId
			: typeof rawVendorId === "string"
				? rawVendorId.toLowerCase().startsWith("0x")
					? Number.parseInt(rawVendorId.slice(2), 16)
					: Number.parseInt(rawVendorId, 10)
				: Number.NaN;
	return (
		{
			[0x1002]: "AMD",
			[0x106b]: "Apple",
			[0x10de]: "NVIDIA",
			[0x8086]: "Intel",
		}[vendorId] ?? null
	);
}

/** Reduces Electron's GPU response to support-safe hardware fields. */
export function sanitizeExportGpuInfo(
	gpuInfo: unknown,
): Pick<ExportHardwareInfo, "machineModel" | "gpus"> {
	if (!gpuInfo || typeof gpuInfo !== "object") {
		return { machineModel: null, gpus: [] };
	}

	const info = gpuInfo as ElectronGpuInfoLike;
	const machineModel =
		[info.machineModelName, info.machineModelVersion]
			.filter((value): value is string => Boolean(value?.trim()))
			.join(" ") || null;
	const gpus = Array.isArray(info.gpuDevice)
		? info.gpuDevice.map((device) => {
				const vendor = getGpuVendorLabel(device);
				return {
					name: device.deviceString?.trim() || vendor || "Unknown GPU",
					vendor,
					active: typeof device.active === "boolean" ? device.active : null,
				};
			})
		: [];

	return { machineModel, gpus };
}

/** Captures sanitized hardware and GPU acceleration details for export support reports. */
export async function getExportHardwareInfo(): Promise<ExportHardwareInfo> {
	let sanitizedGpuInfo: Pick<ExportHardwareInfo, "machineModel" | "gpus"> = {
		machineModel: null,
		gpus: [],
	};
	try {
		sanitizedGpuInfo = sanitizeExportGpuInfo(await app.getGPUInfo("complete"));
	} catch {
		// Hardware diagnostics are best effort and must not affect exporting.
	}

	let gpuFeatureStatus: Record<string, string> = {};
	try {
		gpuFeatureStatus = app.getGPUFeatureStatus() as unknown as Record<string, string>;
	} catch {
		// GPU feature status can be unavailable before Chromium finishes GPU initialization.
	}

	const cpuModel = os.cpus()[0]?.model?.replace(/\s+/g, " ").trim() || null;
	return {
		platform: process.platform,
		release: os.release(),
		arch: process.arch,
		cpuModel,
		logicalProcessors: os.cpus().length,
		totalMemoryGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
		machineModel: sanitizedGpuInfo.machineModel,
		gpus: sanitizedGpuInfo.gpus,
		gpuFeatures: {
			videoDecode: gpuFeatureStatus.video_decode ?? null,
			videoEncode: gpuFeatureStatus.video_encode ?? null,
			webgl: gpuFeatureStatus.webgl ?? null,
			webgpu: gpuFeatureStatus.webgpu ?? null,
		},
	};
}

export async function hasNvidiaGpuForCudaExportCandidate() {
	const hasNvidiaGpu = await probeNvidiaGpuForCudaExportCandidate();
	return hasNvidiaGpu ?? true;
}

export async function probeNvidiaGpuForCudaExportCandidate(): Promise<boolean | null> {
	const getGPUInfo = (
		app as typeof app & {
			getGPUInfo?: (infoType: "basic") => Promise<unknown>;
		}
	).getGPUInfo;
	if (typeof getGPUInfo !== "function") {
		return null;
	}

	try {
		return hasNvidiaGpuDeviceInGpuInfo(await getGPUInfo.call(app, "basic"));
	} catch (error) {
		console.warn(
			"[native-static-layout-export] Unable to inspect GPU info before NVIDIA CUDA export; letting the helper decide",
			error,
		);
		return null;
	}
}
