import {
	getShadowFilterPadding,
	VIDEO_SHADOW_LAYER_PROFILES,
} from "../../src/lib/exporter/shadowProfile";
import { getSquirclePathPoints } from "../../src/lib/geometry/squircle";
import { ATEMPO_FILTER_EPSILON, buildAtempoFilters } from "./ffmpeg/filters";

const NATIVE_EXPORT_INPUT_BYTES_PER_PIXEL = 4;
const MIN_EDITED_TRACK_TEMPO_SPEED = 0.5;
const MAX_EDITED_TRACK_TEMPO_SPEED = 2;

export type NativeExportEncodingMode = "fast" | "balanced" | "quality";

export type NativeVideoExportAudioMode = "none" | "copy-source" | "trim-source" | "edited-track";
export type NativeVideoExportEditedTrackStrategy =
	| "filtergraph-fast-path"
	| "offline-render-fallback";

export interface NativeVideoExportStartOptions {
	width: number;
	height: number;
	frameRate: number;
	bitrate: number;
	encodingMode: NativeExportEncodingMode;
	inputMode?: "rawvideo" | "h264-stream";
}

export interface NativeVideoExportAudioSegment {
	startMs: number;
	endMs: number;
}

export interface NativeVideoExportEditedTrackSegment extends NativeVideoExportAudioSegment {
	speed: number;
}

export interface NativeVideoExportFinishOptions {
	audioMode?: NativeVideoExportAudioMode;
	audioSourcePath?: string | null;
	audioSourceSampleRate?: number;
	outputDurationSec?: number;
	trimSegments?: NativeVideoExportAudioSegment[];
	editedTrackStrategy?: NativeVideoExportEditedTrackStrategy;
	editedTrackSegments?: NativeVideoExportEditedTrackSegment[];
	editedAudioData?: ArrayBuffer;
	editedAudioMimeType?: string | null;
}

export interface NativeVideoAudioMuxMetrics {
	tempVideoWriteMs?: number;
	tempEditedAudioWriteMs?: number;
	ffmpegExecMs?: number;
	muxedVideoReadMs?: number;
	tempVideoBytes?: number;
	tempEditedAudioBytes?: number;
	muxedVideoBytes?: number;
}

export type NativeStaticLayoutBackend =
	| "cuda-overlay"
	| "cuda-scale-cpu-pad"
	| "cuda-static-composite"
	| "nvidia-cuda-compositor"
	| "windows-d3d11-compositor";

export interface NativeStaticLayoutExportArgsConfig {
	inputPath: string;
	outputPath: string;
	width: number;
	height: number;
	frameRate: number;
	bitrate: number;
	encodingMode: NativeExportEncodingMode;
	contentWidth: number;
	contentHeight: number;
	offsetX: number;
	offsetY: number;
	backgroundColor: string;
	backgroundImagePath?: string | null;
	backgroundBlurPx?: number;
	staticBackgroundPath?: string | null;
	maskPath?: string | null;
	borderRadius?: number;
	shadowIntensity?: number;
	startSec?: number;
	durationSec?: number;
}

export interface NativeStaticLayoutChunk {
	index: number;
	startSec: number;
	durationSec: number;
}

export function getNativeVideoInputByteSize(width: number, height: number): number {
	return width * height * NATIVE_EXPORT_INPUT_BYTES_PER_PIXEL;
}

export function parseAvailableFfmpegEncoders(stdout: string): Set<string> {
	const encoders = new Set<string>();

	for (const line of stdout.split(/\r?\n/)) {
		const match = line.match(/^\s*[A-Z.]{6}\s+([a-z0-9_]+)/i);
		if (match?.[1]) {
			encoders.add(match[1]);
		}
	}

	return encoders;
}

export function getPreferredNativeVideoEncoders(platform: NodeJS.Platform): string[] {
	switch (platform) {
		case "darwin":
			return ["h264_videotoolbox", "libx264"];
		case "win32":
			return ["h264_nvenc", "h264_qsv", "h264_amf", "h264_mf", "libx264"];
		case "linux":
			return ["h264_nvenc", "h264_qsv", "libx264"];
		default:
			return ["libx264"];
	}
}

function getLibx264ModeArgs(encodingMode: NativeExportEncodingMode): string[] {
	switch (encodingMode) {
		case "fast":
			return ["-preset", "ultrafast", "-tune", "zerolatency"];
		case "quality":
			return ["-preset", "slow"];
		case "balanced":
		default:
			return ["-preset", "medium"];
	}
}

function getBitrateArgs(bitrate: number): string[] {
	const effectiveBitrate = Math.max(1_500_000, Math.round(bitrate));
	const maxRate = Math.max(effectiveBitrate, Math.round(effectiveBitrate * 1.2));
	const bufferSize = Math.max(maxRate * 2, effectiveBitrate * 2);

	return [
		"-b:v",
		String(effectiveBitrate),
		"-maxrate",
		String(maxRate),
		"-bufsize",
		String(bufferSize),
	];
}

function getNvencStaticLayoutModeArgs(encodingMode: NativeExportEncodingMode): string[] {
	const lowLatencyRateControlArgs = [
		"-rc",
		"vbr",
		"-multipass",
		"disabled",
		"-rc-lookahead",
		"0",
		"-surfaces",
		"32",
	];
	switch (encodingMode) {
		case "quality":
			return ["-preset", "p1", "-tune", "hq", ...lowLatencyRateControlArgs];
		case "balanced":
			return ["-preset", "p1", "-tune", "ll", ...lowLatencyRateControlArgs];
		case "fast":
		default:
			return ["-preset", "p1", "-tune", "ull", ...lowLatencyRateControlArgs];
	}
}

function formatFfmpegColor(value: string): string {
	const trimmed = value.trim();
	const hex = trimmed.match(/^#?([0-9a-f]{6})$/i)?.[1];
	return hex ? `0x${hex.toLowerCase()}` : "0x101010";
}

function clampUnitInterval(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}

	return Math.min(1, Math.max(0, value));
}

function formatFfmpegNumber(value: number): string {
	return Number.isInteger(value)
		? String(value)
		: value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function isPointInsidePolygon(x: number, y: number, points: Array<{ x: number; y: number }>) {
	let inside = false;
	for (
		let index = 0, previousIndex = points.length - 1;
		index < points.length;
		previousIndex = index++
	) {
		const current = points[index];
		const previous = points[previousIndex];
		const intersects =
			current.y > y !== previous.y > y &&
			x < ((previous.x - current.x) * (y - current.y)) / (previous.y - current.y) + current.x;

		if (intersects) {
			inside = !inside;
		}
	}

	return inside;
}

export function createNativeSquircleMaskPgmBuffer(
	width: number,
	height: number,
	radius: number,
): Buffer {
	const safeWidth = Math.max(1, Math.round(width));
	const safeHeight = Math.max(1, Math.round(height));
	const clampedRadius = Math.min(Math.max(0, radius), Math.min(safeWidth, safeHeight) / 2);
	const header = Buffer.from(`P5\n${safeWidth} ${safeHeight}\n255\n`, "ascii");
	const pixels = Buffer.alloc(safeWidth * safeHeight, 255);

	if (clampedRadius <= 0.5) {
		return Buffer.concat([header, pixels]);
	}

	const points = getSquirclePathPoints({
		x: 0,
		y: 0,
		width: safeWidth,
		height: safeHeight,
		radius: clampedRadius,
	});
	const samples = [
		[0.25, 0.25],
		[0.75, 0.25],
		[0.25, 0.75],
		[0.75, 0.75],
	] as const;

	for (let y = 0; y < safeHeight; y += 1) {
		for (let x = 0; x < safeWidth; x += 1) {
			let coveredSamples = 0;
			for (const [sampleX, sampleY] of samples) {
				if (isPointInsidePolygon(x + sampleX, y + sampleY, points)) {
					coveredSamples += 1;
				}
			}
			pixels[y * safeWidth + x] = Math.round((coveredSamples / samples.length) * 255);
		}
	}

	return Buffer.concat([header, pixels]);
}

function pushFfmpegTimeSliceArgs(
	args: string[],
	startSec: number | undefined,
	durationSec: number | undefined,
) {
	if (Number.isFinite(startSec) && (startSec ?? 0) > 0) {
		args.push("-ss", formatFfmpegSeconds((startSec ?? 0) * 1000));
	}

	if (Number.isFinite(durationSec) && (durationSec ?? 0) > 0) {
		args.push("-t", formatFfmpegSeconds((durationSec ?? 0) * 1000));
	}
}

export function buildNativeVideoExportArgs(
	encoder: string,
	options: NativeVideoExportStartOptions,
	outputPath: string,
): string[] {
	const args = [
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		"-f",
		"rawvideo",
		"-pix_fmt",
		"rgba",
		"-s:v",
		`${options.width}x${options.height}`,
		"-framerate",
		String(options.frameRate),
		"-i",
		"pipe:0",
		"-vf",
		"vflip",
		"-an",
		"-c:v",
		encoder,
		"-g",
		String(Math.max(1, Math.round(options.frameRate * 5))),
		...getBitrateArgs(options.bitrate),
	];

	if (encoder === "libx264") {
		args.push(...getLibx264ModeArgs(options.encodingMode));
	}

	args.push("-pix_fmt", "yuv420p", "-movflags", "+faststart", outputPath);
	return args;
}

export function buildNativeCudaOverlayStaticLayoutArgs(
	config: NativeStaticLayoutExportArgsConfig,
): string[] {
	const backgroundColor = formatFfmpegColor(config.backgroundColor);
	const durationSec = formatFfmpegSeconds(Math.max(0.001, config.durationSec ?? 1) * 1000);
	const args = ["-y", "-hide_banner", "-loglevel", "error"];
	pushFfmpegTimeSliceArgs(args, config.startSec, config.durationSec);
	args.push(
		"-hwaccel",
		"cuda",
		"-hwaccel_output_format",
		"cuda",
		"-i",
		config.inputPath,
		"-filter_complex",
		`color=c=${backgroundColor}:s=${config.width}x${config.height}:r=${config.frameRate}:d=${durationSec},format=nv12,hwupload_cuda[bg];[0:v]scale_cuda=w=${config.contentWidth}:h=${config.contentHeight}:format=nv12,fps=${config.frameRate}[fg];[bg][fg]overlay_cuda=${config.offsetX}:${config.offsetY}:shortest=0:repeatlast=1:eof_action=repeat,trim=duration=${durationSec},setpts=PTS-STARTPTS[out]`,
		"-map",
		"[out]",
		"-an",
		"-r",
		String(config.frameRate),
		"-c:v",
		"h264_nvenc",
		...getNvencStaticLayoutModeArgs(config.encodingMode),
		...getBitrateArgs(config.bitrate),
		"-movflags",
		"+faststart",
		config.outputPath,
	);
	return args;
}

export function buildNativeCudaScaleCpuPadStaticLayoutArgs(
	config: NativeStaticLayoutExportArgsConfig,
): string[] {
	const backgroundColor = formatFfmpegColor(config.backgroundColor);
	const args = ["-y", "-hide_banner", "-loglevel", "error"];
	pushFfmpegTimeSliceArgs(args, config.startSec, config.durationSec);
	args.push(
		"-hwaccel",
		"cuda",
		"-hwaccel_output_format",
		"cuda",
		"-i",
		config.inputPath,
		"-vf",
		`scale_cuda=w=${config.contentWidth}:h=${config.contentHeight}:format=nv12:passthrough=0,hwdownload,format=nv12,fps=${config.frameRate},pad=w=${config.width}:h=${config.height}:x=${config.offsetX}:y=${config.offsetY}:color=${backgroundColor}`,
		"-map",
		"0:v:0",
		"-an",
		"-r",
		String(config.frameRate),
		"-c:v",
		"h264_nvenc",
		...getNvencStaticLayoutModeArgs(config.encodingMode),
		...getBitrateArgs(config.bitrate),
		"-pix_fmt",
		"yuv420p",
		"-movflags",
		"+faststart",
		config.outputPath,
	);
	return args;
}

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

	const shadowStrength = clampUnitInterval(config.shadowIntensity ?? 0);
	const shadowLayers =
		shadowStrength > 0 && config.maskPath
			? VIDEO_SHADOW_LAYER_PROFILES.map((layer) => ({
					offsetY: layer.offsetScale * shadowStrength,
					alpha: clampUnitInterval(layer.alphaScale * shadowStrength),
					blur: Math.max(0, layer.blurScale * shadowStrength),
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
	const useMask = Boolean(config.maskPath && (config.borderRadius ?? 0) > 0.5);
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

	const foregroundFilter = `[0:v]scale_cuda=w=${config.contentWidth}:h=${config.contentHeight}:format=nv12:passthrough=0,hwdownload,format=nv12,fps=${config.frameRate},format=rgba[fgbase]`;
	const maskFilter = useMask ? ";[2:v]format=gray[mask];[fgbase][mask]alphamerge[fg]" : "";
	const foregroundLabel = useMask ? "fg" : "fgbase";
	const filterComplex = `${foregroundFilter}${maskFilter};[1:v]format=rgba[bg];[bg][${foregroundLabel}]overlay=x=${config.offsetX}:y=${config.offsetY}:format=auto,trim=duration=${durationSec},setpts=PTS-STARTPTS,format=yuv420p[out]`;

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
		"-movflags",
		"+faststart",
		config.outputPath,
	);
	return args;
}

export function buildNativeConcatArgs(config: { listPath: string; outputPath: string }): string[] {
	return [
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		"-f",
		"concat",
		"-safe",
		"0",
		"-i",
		config.listPath,
		"-c",
		"copy",
		"-movflags",
		"+faststart",
		config.outputPath,
	];
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

function formatFfmpegSeconds(milliseconds: number): string {
	return (milliseconds / 1000).toFixed(3);
}

export function buildTrimmedSourceAudioFilter(
	segments: NativeVideoExportAudioSegment[],
): string | null {
	if (segments.length === 0) {
		return null;
	}

	const filterParts: string[] = [];
	const segmentLabels: string[] = [];

	segments.forEach((segment, index) => {
		const label = `trimmed_audio_${index}`;
		filterParts.push(
			`[1:a]atrim=start=${formatFfmpegSeconds(segment.startMs)}:end=${formatFfmpegSeconds(segment.endMs)},asetpts=PTS-STARTPTS[${label}]`,
		);
		segmentLabels.push(`[${label}]`);
	});

	if (segmentLabels.length === 1) {
		filterParts.push(`${segmentLabels[0]}anull[aout]`);
	} else {
		filterParts.push(`${segmentLabels.join("")}concat=n=${segmentLabels.length}:v=0:a=1[aout]`);
	}

	return filterParts.join(";");
}

export function buildEditedTrackSourceAudioFilter(
	segments: NativeVideoExportEditedTrackSegment[],
	sourceSampleRate: number,
): string | null {
	if (segments.length === 0 || !Number.isFinite(sourceSampleRate) || sourceSampleRate <= 0) {
		return null;
	}

	const normalizedSourceSampleRate = Math.round(sourceSampleRate);
	if (normalizedSourceSampleRate < 1) {
		return null;
	}

	const filterParts: string[] = [];
	const segmentLabels: string[] = [];
	let hasInvalidSegment = false;

	segments.forEach((segment, index) => {
		if (
			!Number.isFinite(segment.startMs) ||
			!Number.isFinite(segment.endMs) ||
			segment.startMs < 0 ||
			segment.endMs < 0
		) {
			hasInvalidSegment = true;
			return;
		}

		if (segment.endMs - segment.startMs <= 0.5) {
			hasInvalidSegment = true;
			return;
		}

		const label = `edited_audio_${index}`;
		const speed = segment.speed;
		if (
			!Number.isFinite(speed) ||
			speed < MIN_EDITED_TRACK_TEMPO_SPEED ||
			speed > MAX_EDITED_TRACK_TEMPO_SPEED
		) {
			hasInvalidSegment = true;
			return;
		}

		const segmentFilter = [
			`[1:a]atrim=start=${formatFfmpegSeconds(segment.startMs)}:end=${formatFfmpegSeconds(segment.endMs)}`,
			"asetpts=PTS-STARTPTS",
		];

		const tempoFilters = buildAtempoFilters(speed);
		if (tempoFilters.length > 0) {
			segmentFilter.push(...tempoFilters);
		} else if (Math.abs(speed - 1) > ATEMPO_FILTER_EPSILON) {
			hasInvalidSegment = true;
			return;
		}

		filterParts.push(`${segmentFilter.join(",")}[${label}]`);
		segmentLabels.push(`[${label}]`);
	});

	if (hasInvalidSegment || segmentLabels.length === 0) {
		return null;
	}

	if (segmentLabels.length === 1) {
		filterParts.push(`${segmentLabels[0]}anull[aout]`);
	} else {
		filterParts.push(`${segmentLabels.join("")}concat=n=${segmentLabels.length}:v=0:a=1[aout]`);
	}

	return filterParts.join(";");
}

/**
 * Builds FFmpeg arguments for a zero-copy H.264 stream export.
 * FFmpeg receives a pre-encoded Annex B H.264 stream on stdin (produced by the
 * browser's hardware VideoEncoder) and copies it straight into an MP4 container
 * — no re-encoding step, no raw pixel IPC traffic.
 */
export function buildNativeH264StreamExportArgs(config: {
	frameRate: number;
	outputPath: string;
}): string[] {
	return [
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		// Input 0: pre-encoded H.264 Annex B stream from browser VideoEncoder via stdin
		"-f",
		"h264",
		"-r",
		String(config.frameRate),
		"-i",
		"pipe:0",
		"-an", // audio handled separately by muxNativeVideoExportAudio
		"-c:v",
		"copy",
		"-movflags",
		"+faststart",
		config.outputPath,
	];
}

export function getEditedAudioExtension(mimeType?: string | null): string {
	if (!mimeType) {
		return ".webm";
	}

	if (mimeType.includes("wav")) {
		return ".wav";
	}

	if (mimeType.includes("mp4") || mimeType.includes("m4a")) {
		return ".m4a";
	}

	if (mimeType.includes("ogg")) {
		return ".ogg";
	}

	return ".webm";
}
