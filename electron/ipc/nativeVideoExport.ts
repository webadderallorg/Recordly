const NATIVE_EXPORT_INPUT_BYTES_PER_PIXEL = 4;

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
	const filterParts: string[] = [];
	const segmentLabels: string[] = [];

	segments.forEach((segment, index) => {
		if (segment.endMs - segment.startMs <= 0.5) {
			return;
		}

		const label = `edited_audio_${index}`;
		const speed = Number.isFinite(segment.speed) && segment.speed > 0 ? segment.speed : 1;
		const segmentFilter = [
			`[1:a]atrim=start=${formatFfmpegSeconds(segment.startMs)}:end=${formatFfmpegSeconds(segment.endMs)}`,
			"asetpts=PTS-STARTPTS",
		];

		if (Math.abs(speed - 1) > 0.0001) {
			segmentFilter.push(
				`asetrate=${Math.max(1, Math.round(normalizedSourceSampleRate * speed))}`,
				`aresample=${normalizedSourceSampleRate}`,
			);
		}

		filterParts.push(`${segmentFilter.join(",")}[${label}]`);
		segmentLabels.push(`[${label}]`);
	});

	if (segmentLabels.length === 0) {
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
