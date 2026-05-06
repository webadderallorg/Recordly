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
	trimSegments?: NativeVideoExportAudioSegment[];
	editedTrackStrategy?: NativeVideoExportEditedTrackStrategy;
	editedTrackSegments?: NativeVideoExportEditedTrackSegment[];
	editedAudioData?: ArrayBuffer;
	editedAudioMimeType?: string | null;
}

export interface NativeFastVideoExportSegment {
	startMs: number;
	endMs: number;
}

export interface NativeFastVideoExportOptions {
	sourcePath: string;
	width: number;
	height: number;
	frameRate: number;
	bitrate: number;
	encodingMode: NativeExportEncodingMode;
	videoMode?: "copy" | "encode";
	segments?: NativeFastVideoExportSegment[];
}

export interface NativeFastVideoSourceProbe {
	videoCodecName: string | null;
	audioCodecName: string | null;
	pixelFormat: string | null;
	width: number | null;
	height: number | null;
	fps: number | null;
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

function getVideoEncodeArgs(
	encoder: string,
	options: Pick<NativeFastVideoExportOptions, "bitrate" | "encodingMode">,
): string[] {
	const args = ["-c:v", encoder, ...getBitrateArgs(options.bitrate)];

	if (encoder === "libx264") {
		args.push(...getLibx264ModeArgs(options.encodingMode));
	}

	return args;
}

function formatFfmpegSeconds(milliseconds: number): string {
	return (milliseconds / 1000).toFixed(3);
}

function normalizeCodecName(codecName: string | null | undefined): string | null {
	return codecName ? codecName.trim().toLowerCase() : null;
}

function parseFps(value: string | undefined): number | null {
	if (!value) {
		return null;
	}

	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function parseNativeFastVideoSourceProbe(ffmpegOutput: string): NativeFastVideoSourceProbe {
	const videoLine = ffmpegOutput
		.split(/\r?\n/)
		.find((line) => /\bVideo:\s*[a-z0-9_]+/i.test(line));
	const audioLine = ffmpegOutput
		.split(/\r?\n/)
		.find((line) => /\bAudio:\s*[a-z0-9_]+/i.test(line));
	const dimensionsMatch = videoLine?.match(/,\s*(\d{2,5})x(\d{2,5})(?:\s|,|\[)/);
	const fpsMatch = videoLine?.match(/,\s*([0-9.]+)\s*fps\b/i);
	const pixelFormatMatch = videoLine?.match(/\bVideo:\s*[a-z0-9_]+[^,]*,\s*([a-z0-9_]+)/i);

	return {
		videoCodecName: normalizeCodecName(videoLine?.match(/\bVideo:\s*([a-z0-9_]+)/i)?.[1]),
		audioCodecName: normalizeCodecName(audioLine?.match(/\bAudio:\s*([a-z0-9_]+)/i)?.[1]),
		pixelFormat: normalizeCodecName(pixelFormatMatch?.[1]),
		width: dimensionsMatch ? Number.parseInt(dimensionsMatch[1], 10) : null,
		height: dimensionsMatch ? Number.parseInt(dimensionsMatch[2], 10) : null,
		fps: parseFps(fpsMatch?.[1]),
	};
}

export function canStreamCopyNativeFastVideoExport(
	probe: NativeFastVideoSourceProbe,
	options: NativeFastVideoExportOptions,
): boolean {
	if ((options.segments?.length ?? 0) > 0) {
		return false;
	}

	if (probe.videoCodecName !== "h264") {
		return false;
	}

	if (probe.pixelFormat !== "yuv420p" && probe.pixelFormat !== "yuvj420p") {
		return false;
	}

	if (probe.audioCodecName && probe.audioCodecName !== "aac" && probe.audioCodecName !== "mp3") {
		return false;
	}

	if (
		probe.width !== Math.round(options.width) ||
		probe.height !== Math.round(options.height) ||
		probe.fps === null
	) {
		return false;
	}

	return Math.abs(probe.fps - options.frameRate) <= 0.1;
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

function buildNativeFastVideoFilter(options: NativeFastVideoExportOptions): string {
	return [
		`scale=${Math.round(options.width)}:${Math.round(options.height)}:flags=lanczos`,
		"setsar=1",
		`fps=${Math.round(options.frameRate)}`,
		"format=yuv420p",
	].join(",");
}

export function buildNativeFastVideoExportArgs(
	encoder: string,
	options: NativeFastVideoExportOptions,
	outputPath: string,
): string[] {
	const segments = (options.segments ?? []).filter(
		(segment) =>
			Number.isFinite(segment.startMs) &&
			Number.isFinite(segment.endMs) &&
			segment.startMs >= 0 &&
			segment.endMs - segment.startMs > 0.5,
	);
	const args = ["-y", "-hide_banner", "-loglevel", "error"];
	const singleSegment = segments.length === 1 ? segments[0] : null;

	if (singleSegment && singleSegment.startMs > 0) {
		args.push("-ss", formatFfmpegSeconds(singleSegment.startMs));
	}

	if (singleSegment) {
		args.push("-t", formatFfmpegSeconds(singleSegment.endMs - singleSegment.startMs));
	}

	args.push("-i", options.sourcePath, "-map", "0:v:0", "-map", "0:a:0?");

	if (options.videoMode === "copy") {
		args.push("-c:v", "copy", "-c:a", "copy", "-movflags", "+faststart", outputPath);
		return args;
	}

	args.push("-vf", buildNativeFastVideoFilter(options));
	args.push(...getVideoEncodeArgs(encoder, options));
	args.push("-c:a", "copy", "-shortest", "-movflags", "+faststart", outputPath);

	return args;
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
