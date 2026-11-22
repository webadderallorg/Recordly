import { execFile } from "node:child_process";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";

export const execFileAsync = promisify(execFile);

export const getNowMs = () => performance.now();

export const formatFfmpegSeconds = (milliseconds: number) => (milliseconds / 1000).toFixed(3);

export const MISSING_NATIVE_STATIC_BACKGROUND_COLOR = "#ffffff";

export const NATIVE_EXPORT_HIGH_PRIORITY = os.constants.priority.PRIORITY_HIGH;

export const NVIDIA_PCI_VENDOR_ID = 0x10de;

export const NVIDIA_CUDA_EXPORT_ENV = "RECORDLY_EXPERIMENTAL_NVIDIA_CUDA_EXPORT";

export const NVIDIA_CUDA_ALLOW_AUDIO_EXPORT_ENV = "RECORDLY_NVIDIA_CUDA_ALLOW_AUDIO_EXPORT";

export const NVIDIA_CUDA_FORCE_VIDEO_ONLY_ENV = "RECORDLY_NVIDIA_CUDA_FORCE_VIDEO_ONLY";

export const NVIDIA_CUDA_AUTO_STALL_TIMEOUT_ENV = "RECORDLY_NVIDIA_CUDA_AUTO_STALL_TIMEOUT_MS";

export const DEFAULT_NVIDIA_CUDA_AUTO_STALL_TIMEOUT_MS = 120_000;

export const NATIVE_GPU_STALL_TIMEOUT_ENV = "RECORDLY_NATIVE_GPU_STALL_TIMEOUT_MS";

export const DEFAULT_NATIVE_GPU_STALL_TIMEOUT_MS = 120_000;

export const NATIVE_STATIC_LAYOUT_SOURCE_PROXY_REFERENCE_PIXEL_RATE = 1920 * 1080 * 30;

export const NATIVE_STATIC_LAYOUT_SOURCE_PROXY_1080P30_BITRATE = 24_000_000;

export const NATIVE_STATIC_LAYOUT_SOURCE_PROXY_MAX_BITRATE = 80_000_000;

export const NATIVE_STATIC_LAYOUT_SOURCE_PROXY_CONTAINERS = new Set([".mp4", ".m4v", ".mov"]);
