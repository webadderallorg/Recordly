import fs from "node:fs/promises";
import path from "node:path";
import { MISSING_NATIVE_STATIC_BACKGROUND_COLOR } from "./constants";
import { runFfmpegWithMetrics } from "./process";
import { type NativeStaticLayoutExportOptions } from "./types";

export function toConcatFileLine(filePath: string) {
	const normalized = filePath.replace(/\\/g, "/").replace(/'/g, "'\\''");
	return `file '${normalized}'`;
}

export function getStaticLayoutChunkOutputPath(directory: string, index: number) {
	return path.join(directory, `chunk-${String(index).padStart(4, "0")}.mp4`);
}

export function shouldUsePrecompositedStaticLayout(options: NativeStaticLayoutExportOptions) {
	return Boolean(
		options.backgroundImagePath ||
			(options.borderRadius ?? 0) > 0 ||
			(options.shadowIntensity ?? 0) > 0,
	);
}

export async function normalizeNativeStaticLayoutBackground(
	options: NativeStaticLayoutExportOptions,
): Promise<NativeStaticLayoutExportOptions> {
	if (!options.backgroundImagePath || (await pathExists(options.backgroundImagePath))) {
		return options;
	}

	console.warn(
		"[native-static-layout-export] Background image is missing; using solid fallback",
		{
			backgroundImagePath: options.backgroundImagePath,
		},
	);
	return {
		...options,
		backgroundColor: MISSING_NATIVE_STATIC_BACKGROUND_COLOR,
		backgroundImagePath: null,
	};
}

export function getFfmpegFailureMessage(result: Awaited<ReturnType<typeof runFfmpegWithMetrics>>) {
	const suffix = result.signal ? ` (signal ${result.signal})` : "";
	const status = result.code === null ? "unknown" : String(result.code);
	return result.stderr.trim() || `FFmpeg exited with code ${status}${suffix}`;
}

export function clampUnit(value: number) {
	if (!Number.isFinite(value)) {
		return 0;
	}

	return Math.min(1, Math.max(0, value));
}

export function formatCliNumber(value: number) {
	return Number.isInteger(value)
		? String(value)
		: value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

export function hasNativeStaticLayoutTimeline(options: NativeStaticLayoutExportOptions) {
	return (options.timelineSegments?.length ?? 0) > 0;
}

export function hasNativeStaticLayoutSourceCrop(options: NativeStaticLayoutExportOptions) {
	return Boolean(
		Number.isFinite(options.sourceCropWidth) &&
			Number.isFinite(options.sourceCropHeight) &&
			(options.sourceCropWidth ?? 0) >= 2 &&
			(options.sourceCropHeight ?? 0) >= 2,
	);
}

export async function pathExists(filePath: string) {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}
