import path from "node:path";
import { clampUnit, formatCliNumber } from "./layout";
import { type NativeStaticLayoutExportOptions } from "./types";

export function convertHexColorToNv12(color: string) {
	const hex = color.trim().match(/^#?([0-9a-f]{6})$/i)?.[1] ?? "101010";
	const r = Number.parseInt(hex.slice(0, 2), 16);
	const g = Number.parseInt(hex.slice(2, 4), 16);
	const b = Number.parseInt(hex.slice(4, 6), 16);
	const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

	return {
		y: clampByte(((66 * r + 129 * g + 25 * b + 128) >> 8) + 16),
		u: clampByte(((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128),
		v: clampByte(((112 * r - 94 * g - 18 * b + 128) >> 8) + 128),
	};
}

export function getNvidiaCudaBitrateMbps(options: NativeStaticLayoutExportOptions) {
	return Math.max(1, Math.round(options.bitrate / 1_000_000));
}

export function buildExperimentalWindowsGpuStaticLayoutArgs(
	options: NativeStaticLayoutExportOptions,
	outputPath: string,
) {
	const shadowPixels = Math.round(clampUnit(options.shadowIntensity ?? 0) * 64);
	const backgroundBlurPx = Math.max(0, options.backgroundBlurPx ?? 0);
	const pixelCount = options.width * options.height;
	const surfacePoolSize = pixelCount <= 1920 * 1080 ? 12 : 8;
	const args = [
		"--input",
		options.inputPath,
		"--output",
		outputPath,
		"--width",
		String(options.width),
		"--height",
		String(options.height),
		"--fps",
		String(options.frameRate),
		"--seconds",
		formatCliNumber(options.durationSec),
		"--bitrate",
		String(options.bitrate),
		"--shader-composite",
		"--radius",
		formatCliNumber(Math.max(0, options.borderRadius ?? 0)),
		"--shadow",
		formatCliNumber(shadowPixels),
		"--content-left",
		String(Math.round(options.offsetX)),
		"--content-top",
		String(Math.round(options.offsetY)),
		"--content-width",
		String(Math.round(options.contentWidth)),
		"--content-height",
		String(Math.round(options.contentHeight)),
		"--background-color",
		options.backgroundColor,
		"--surface-pool-size",
		String(surfacePoolSize),
	];

	if (options.backgroundImagePath) {
		args.push("--background-image", options.backgroundImagePath);
	}
	if (
		Number.isFinite(options.sourceCropX) &&
		Number.isFinite(options.sourceCropY) &&
		Number.isFinite(options.sourceCropWidth) &&
		Number.isFinite(options.sourceCropHeight) &&
		(options.sourceCropWidth ?? 0) >= 2 &&
		(options.sourceCropHeight ?? 0) >= 2
	) {
		args.push(
			"--source-crop-x",
			String(Math.round(options.sourceCropX ?? 0)),
			"--source-crop-y",
			String(Math.round(options.sourceCropY ?? 0)),
			"--source-crop-width",
			String(Math.round(options.sourceCropWidth ?? 0)),
			"--source-crop-height",
			String(Math.round(options.sourceCropHeight ?? 0)),
		);
	}
	if (backgroundBlurPx > 0) {
		args.push("--background-blur", formatCliNumber(backgroundBlurPx));
	}
	if (options.webcamInputPath) {
		const webcamShadowPixels = Math.round(clampUnit(options.webcamShadowIntensity ?? 0) * 64);
		args.push(
			"--webcam-input",
			options.webcamInputPath,
			"--webcam-left",
			String(Math.round(options.webcamLeft ?? 0)),
			"--webcam-top",
			String(Math.round(options.webcamTop ?? 0)),
			"--webcam-size",
			String(Math.round(options.webcamSize ?? 0)),
			"--webcam-radius",
			formatCliNumber(Math.max(0, options.webcamRadius ?? 0)),
			"--webcam-shadow",
			formatCliNumber(webcamShadowPixels),
			"--webcam-time-offset-ms",
			formatCliNumber(options.webcamTimeOffsetMs ?? 0),
		);
		if (options.webcamMirror !== false) {
			args.push("--webcam-mirror");
		}
	}
	if (options.cursorTelemetryPath) {
		args.push(
			"--cursor-telemetry",
			options.cursorTelemetryPath,
			"--cursor-size",
			formatCliNumber(Math.max(1, options.cursorSize ?? 84)),
		);
		if (options.cursorAtlasPath && options.cursorAtlasMetadataPath) {
			args.push(
				"--cursor-atlas",
				options.cursorAtlasPath,
				"--cursor-atlas-metadata",
				options.cursorAtlasMetadataPath,
			);
		}
	}
	if (options.zoomTelemetryPath) {
		args.push("--zoom-telemetry", options.zoomTelemetryPath);
	}
	if (options.timelineMapPath) {
		args.push("--timeline-map", options.timelineMapPath);
	}

	return args;
}

export function buildExperimentalNvidiaCudaStaticLayoutArgs(
	options: NativeStaticLayoutExportOptions,
	outputPath: string,
	workDir: string,
) {
	const background = convertHexColorToNv12(options.backgroundColor);
	const backgroundBlurPx = Math.max(0, options.backgroundBlurPx ?? 0);
	const shadowIntensityPct = Math.round(clampUnit(options.shadowIntensity ?? 0) * 100);
	const shadowOffsetY =
		shadowIntensityPct > 0 ? Math.max(1, Math.round(options.height * 0.012)) : 0;
	const args = [
		"--input",
		options.inputPath,
		"--output",
		outputPath,
		"--work-dir",
		workDir,
		"--width",
		String(options.width),
		"--height",
		String(options.height),
		"--fps",
		String(Math.max(1, Math.round(options.frameRate))),
		"--bitrate-mbps",
		String(getNvidiaCudaBitrateMbps(options)),
		"--encoding-mode",
		options.encodingMode,
		"--duration-sec",
		formatCliNumber(options.durationSec),
		"--stream-sync",
		"--prewarm-ms",
		process.env.RECORDLY_NVIDIA_CUDA_PREWARM_MS || "500",
		"--content-x",
		String(Math.round(options.offsetX)),
		"--content-y",
		String(Math.round(options.offsetY)),
		"--content-width",
		String(Math.round(options.contentWidth)),
		"--content-height",
		String(Math.round(options.contentHeight)),
		"--radius",
		String(Math.round(Math.max(0, options.borderRadius ?? 0))),
		"--background-y",
		String(background.y),
		"--background-u",
		String(background.u),
		"--background-v",
		String(background.v),
	];
	if (!canMuxNvidiaCudaSourceAudioInline(options)) {
		args.push("--video-only");
	}

	if (options.backgroundImagePath) {
		args.push("--background-image", options.backgroundImagePath);
	}
	if (
		Number.isFinite(options.sourceCropX) &&
		Number.isFinite(options.sourceCropY) &&
		Number.isFinite(options.sourceCropWidth) &&
		Number.isFinite(options.sourceCropHeight) &&
		(options.sourceCropWidth ?? 0) >= 2 &&
		(options.sourceCropHeight ?? 0) >= 2
	) {
		args.push(
			"--source-crop-x",
			String(Math.round(options.sourceCropX ?? 0)),
			"--source-crop-y",
			String(Math.round(options.sourceCropY ?? 0)),
			"--source-crop-width",
			String(Math.round(options.sourceCropWidth ?? 0)),
			"--source-crop-height",
			String(Math.round(options.sourceCropHeight ?? 0)),
		);
	}
	if (backgroundBlurPx > 0) {
		args.push("--background-blur", formatCliNumber(backgroundBlurPx));
	}
	if (shadowOffsetY > 0 && shadowIntensityPct > 0) {
		args.push(
			"--shadow-offset-y",
			String(shadowOffsetY),
			"--shadow-intensity-pct",
			String(shadowIntensityPct),
		);
	}
	if (options.webcamInputPath && (options.webcamSize ?? 0) > 0) {
		args.push(
			"--webcam-input",
			options.webcamInputPath,
			"--webcam-x",
			String(Math.round(options.webcamLeft ?? 0)),
			"--webcam-y",
			String(Math.round(options.webcamTop ?? 0)),
			"--webcam-size",
			String(Math.round(options.webcamSize ?? 0)),
			"--webcam-radius",
			String(Math.round(Math.max(0, options.webcamRadius ?? 0))),
			"--webcam-time-offset-ms",
			formatCliNumber(options.webcamTimeOffsetMs ?? 0),
			"--webcam-stream",
		);
		if (options.webcamMirror !== false) {
			args.push("--webcam-mirror");
		}
	}
	if (options.cursorTelemetryPath) {
		args.push(
			"--cursor-json",
			options.cursorTelemetryPath,
			"--cursor-height",
			String(Math.round(Math.max(1, options.cursorSize ?? 84))),
			"--cursor-style",
			"external",
		);
		if (options.cursorAtlasPath && options.cursorAtlasMetadataPath) {
			args.push(
				"--cursor-atlas-png",
				options.cursorAtlasPath,
				"--cursor-atlas-metadata",
				options.cursorAtlasMetadataPath,
			);
		}
	}
	if (options.zoomTelemetryPath) {
		args.push("--zoom-telemetry", options.zoomTelemetryPath);
	}
	if (options.timelineMapPath) {
		args.push("--timeline-map", options.timelineMapPath);
	}
	if (process.env.RECORDLY_NVIDIA_CUDA_SAMPLE_GPU === "1") {
		args.push("--sample-gpu");
	}

	return args;
}

export function canMuxNvidiaCudaSourceAudioInline(options: NativeStaticLayoutExportOptions) {
	if (options.nvidiaCudaForceVideoOnly) {
		return false;
	}

	const audioOptions = options.audioOptions;
	if (audioOptions?.audioMode !== "copy-source" || !audioOptions.audioSourcePath) {
		return false;
	}

	return path.resolve(audioOptions.audioSourcePath) === path.resolve(options.inputPath);
}
