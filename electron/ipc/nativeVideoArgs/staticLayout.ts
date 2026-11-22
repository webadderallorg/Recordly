import {
	getShadowFilterPadding,
	getVideoShadowStrength,
	VIDEO_SHADOW_LAYER_PROFILES,
	VIDEO_SHADOW_REFERENCE_WIDTH,
} from "../../../src/lib/exporter/shadowProfile";
import { formatFfmpegSeconds } from "./audioFilters";
import {
	FFMPEG_AUTO_TO_FULL_RANGE_FILTER,
	FFMPEG_BT709_VIDEO_COLOR_ARGS,
	FFMPEG_FULL_TO_VIDEO_RANGE_FILTER,
} from "./constants";
import {
	clampUnitInterval,
	formatFfmpegColor,
	formatFfmpegNumber,
	getBitrateArgs,
	getNvencStaticLayoutModeArgs,
	pushFfmpegTimeSliceArgs,
} from "./encoding";
import { type NativeStaticLayoutChunk, type NativeStaticLayoutExportArgsConfig } from "./types";

export function buildNativeStaticBackgroundRenderArgs(
	config: NativeStaticLayoutExportArgsConfig,
): string[] {
	const backgroundColor = formatFfmpegColor(config.backgroundColor);
	const backgroundBlurPx = Math.max(0, config.backgroundBlurPx ?? 0);
	const args = ["-y", "-hide_banner", "-loglevel", "error"];
	if (config.backgroundImagePath) {
		args.push("-i", config.backgroundImagePath);
	} else {
		args.push(
			"-f",
			"lavfi",
			"-i",
			`color=c=${backgroundColor}:s=${config.width}x${config.height}:d=1`,
		);
	}

	const shadowStrength = getVideoShadowStrength(config.shadowIntensity ?? 0);
	const shadowScale = Math.max(1, config.width) / VIDEO_SHADOW_REFERENCE_WIDTH;
	const shadowLayers =
		shadowStrength > 0 && config.maskPath
			? VIDEO_SHADOW_LAYER_PROFILES.map((layer) => ({
					offsetY: layer.offsetScale * shadowStrength * shadowScale,
					alpha: clampUnitInterval(layer.alphaScale * shadowStrength),
					blur: Math.max(0, layer.blurScale * shadowStrength * shadowScale),
				})).filter((layer) => layer.alpha > 0)
			: [];

	if (shadowLayers.length > 0 && config.maskPath) {
		args.push("-i", config.maskPath);
	}

	const filterParts = [
		config.backgroundImagePath
			? `[0:v]scale=w=${config.width}:h=${config.height}:force_original_aspect_ratio=increase,crop=w=${config.width}:h=${config.height},setsar=1,format=rgba[bg0]`
			: "[0:v]format=rgba[bg0]",
	];
	let currentBackgroundLabel = "bg0";
	if (backgroundBlurPx > 0 && config.backgroundImagePath) {
		filterParts.push(
			`[${currentBackgroundLabel}]gblur=sigma=${formatFfmpegNumber(
				Math.min(96, backgroundBlurPx),
			)}:steps=2[bg_blur]`,
		);
		currentBackgroundLabel = "bg_blur";
	}

	if (shadowLayers.length > 0) {
		filterParts.push(
			`[1:v]format=gray,split=${shadowLayers.length}${shadowLayers
				.map((_, index) => `[shadow_mask_source_${index}]`)
				.join("")}`,
		);
	}

	shadowLayers.forEach((layer, index) => {
		const padding = getShadowFilterPadding(layer.blur, layer.offsetY);
		const paddedWidth = config.contentWidth + padding * 2;
		const paddedHeight = config.contentHeight + padding * 2;
		const positionedMaskLabel = `shadow_mask_positioned_${index}`;
		const shadowMaskLabel = `shadow_mask_${index}`;
		const shadowColorLabel = `shadow_color_${index}`;
		const shadowLabel = `shadow_${index}`;
		const nextBackgroundLabel = `bg${index + 1}`;
		const blurFilter =
			layer.blur > 0 ? `,gblur=sigma=${formatFfmpegNumber(layer.blur)}:steps=2` : "";

		filterParts.push(
			`[shadow_mask_source_${index}]lut=y=val*${formatFfmpegNumber(
				layer.alpha,
			)},pad=w=${paddedWidth}:h=${paddedHeight}:x=${padding}:y=${Math.round(
				padding + layer.offsetY,
			)}:color=black${blurFilter}[${positionedMaskLabel}]`,
			`[${positionedMaskLabel}]format=gray[${shadowMaskLabel}]`,
			`color=c=black:s=${paddedWidth}x${paddedHeight}:d=1,format=rgba[${shadowColorLabel}]`,
			`[${shadowColorLabel}][${shadowMaskLabel}]alphamerge[${shadowLabel}]`,
			`[${currentBackgroundLabel}][${shadowLabel}]overlay=x=${
				config.offsetX - padding
			}:y=${config.offsetY - padding}:format=auto[${nextBackgroundLabel}]`,
		);
		currentBackgroundLabel = nextBackgroundLabel;
	});

	filterParts.push(`[${currentBackgroundLabel}]format=rgba[out]`);
	args.push(
		"-filter_complex",
		filterParts.join(";"),
		"-map",
		"[out]",
		"-frames:v",
		"1",
		config.outputPath,
	);
	return args;
}

export function buildNativePrecompositedStaticLayoutArgs(
	config: NativeStaticLayoutExportArgsConfig,
): string[] {
	if (!config.staticBackgroundPath) {
		throw new Error("Native precomposited static layout requires a static background path");
	}

	const durationSec = formatFfmpegSeconds(Math.max(0.001, config.durationSec ?? 1) * 1000);
	const useMask = Boolean(config.maskPath && (config.borderRadius ?? 0) > 0);
	const args = ["-y", "-hide_banner", "-loglevel", "error"];
	pushFfmpegTimeSliceArgs(args, config.startSec, config.durationSec);
	args.push(
		"-hwaccel",
		"cuda",
		"-hwaccel_output_format",
		"cuda",
		"-i",
		config.inputPath,
		"-loop",
		"1",
		"-framerate",
		String(config.frameRate),
		"-t",
		durationSec,
		"-i",
		config.staticBackgroundPath,
	);

	if (useMask && config.maskPath) {
		args.push(
			"-loop",
			"1",
			"-framerate",
			String(config.frameRate),
			"-t",
			durationSec,
			"-i",
			config.maskPath,
		);
	}

	const foregroundFilter = `[0:v]scale_cuda=w=${config.contentWidth}:h=${config.contentHeight}:format=nv12:passthrough=0,hwdownload,format=nv12,${FFMPEG_AUTO_TO_FULL_RANGE_FILTER},fps=${config.frameRate},format=rgba[fgbase]`;
	const maskFilter = useMask ? ";[2:v]format=gray[mask];[fgbase][mask]alphamerge[fg]" : "";
	const foregroundLabel = useMask ? "fg" : "fgbase";
	const filterComplex = `${foregroundFilter}${maskFilter};[1:v]format=rgba[bg];[bg][${foregroundLabel}]overlay=x=${config.offsetX}:y=${config.offsetY}:format=auto,trim=duration=${durationSec},setpts=PTS-STARTPTS,${FFMPEG_FULL_TO_VIDEO_RANGE_FILTER},format=yuv420p[out]`;

	args.push(
		"-filter_complex",
		filterComplex,
		"-map",
		"[out]",
		"-an",
		"-r",
		String(config.frameRate),
		"-c:v",
		"h264_nvenc",
		...getNvencStaticLayoutModeArgs(config.encodingMode),
		...getBitrateArgs(config.bitrate),
		"-pix_fmt",
		"yuv420p",
		...FFMPEG_BT709_VIDEO_COLOR_ARGS,
		"-movflags",
		"+faststart",
		config.outputPath,
	);
	return args;
}

export function buildNativeStaticLayoutChunks(
	durationSec: number,
	chunkDurationSec: number,
): NativeStaticLayoutChunk[] {
	if (!Number.isFinite(durationSec) || durationSec <= 0) {
		return [];
	}

	const safeChunkDuration = Math.max(1, Math.min(300, Math.floor(chunkDurationSec)));
	const chunks: NativeStaticLayoutChunk[] = [];
	for (
		let startSec = 0, index = 0;
		startSec < durationSec;
		startSec += safeChunkDuration, index++
	) {
		chunks.push({
			index,
			startSec,
			durationSec: Math.min(safeChunkDuration, durationSec - startSec),
		});
	}

	return chunks;
}

export function isNativeCudaOutOfMemory(stderr: string): boolean {
	return /CUDA_ERROR_OUT_OF_MEMORY|cuMemAlloc.+out of memory/i.test(stderr);
}
