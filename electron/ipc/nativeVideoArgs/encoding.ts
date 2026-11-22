import { formatFfmpegSeconds } from "./audioFilters";
import {
	FFMPEG_AUTO_TO_VIDEO_RANGE_FILTER,
	FFMPEG_BT709_VIDEO_COLOR_ARGS,
	FFMPEG_FULL_TO_VIDEO_RANGE_FILTER,
	NATIVE_EXPORT_INPUT_BYTES_PER_PIXEL,
} from "./constants";
import {
	type NativeExportEncodingMode,
	type NativeStaticLayoutExportArgsConfig,
	type NativeVideoExportStartOptions,
} from "./types";

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

export function getLibx264ModeArgs(encodingMode: NativeExportEncodingMode): string[] {
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

export function getBitrateArgs(bitrate: number): string[] {
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

export function getNvencStaticLayoutModeArgs(encodingMode: NativeExportEncodingMode): string[] {
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

export function formatFfmpegColor(value: string): string {
	const trimmed = value.trim();
	const hex = trimmed.match(/^#?([0-9a-f]{6})$/i)?.[1];
	return hex ? `0x${hex.toLowerCase()}` : "0x101010";
}

export function clampUnitInterval(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}

	return Math.min(1, Math.max(0, value));
}

export function formatFfmpegNumber(value: number): string {
	return Number.isInteger(value)
		? String(value)
		: value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

export function pushFfmpegTimeSliceArgs(
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
		`vflip,${FFMPEG_FULL_TO_VIDEO_RANGE_FILTER}`,
		"-an",
		"-c:v",
		encoder,
		"-g",
		String(Math.max(1, Math.round(options.frameRate * 5))),
		...(options.deliveryProfile === "cloud" && encoder === "libx264"
			? [
					"-crf",
					"23",
					"-maxrate",
					String(Math.max(1_500_000, Math.round(options.bitrate))),
					"-bufsize",
					String(Math.max(3_000_000, Math.round(options.bitrate * 2))),
				]
			: getBitrateArgs(options.bitrate)),
	];

	if (options.deliveryProfile === "cloud" && encoder === "libx264") {
		// Software fallback keeps files compact without the slow preset's extra CPU cost.
		args.push("-preset", "medium", "-threads", "4");
	} else if (encoder === "libx264") {
		args.push(...getLibx264ModeArgs(options.encodingMode));
	}

	args.push(
		"-pix_fmt",
		"yuv420p",
		...FFMPEG_BT709_VIDEO_COLOR_ARGS,
		"-movflags",
		"+faststart",
		outputPath,
	);
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
		`color=c=${backgroundColor}:s=${config.width}x${config.height}:r=${config.frameRate}:d=${durationSec},format=nv12,setrange=limited,hwupload_cuda[bg];[0:v]scale_cuda=w=${config.contentWidth}:h=${config.contentHeight}:format=nv12:passthrough=0,hwdownload,format=nv12,${FFMPEG_AUTO_TO_VIDEO_RANGE_FILTER},fps=${config.frameRate},hwupload_cuda[fg];[bg][fg]overlay_cuda=${config.offsetX}:${config.offsetY}:shortest=0:repeatlast=1:eof_action=repeat,trim=duration=${durationSec},setpts=PTS-STARTPTS[out]`,
		"-map",
		"[out]",
		"-an",
		"-r",
		String(config.frameRate),
		"-c:v",
		"h264_nvenc",
		...getNvencStaticLayoutModeArgs(config.encodingMode),
		...getBitrateArgs(config.bitrate),
		...FFMPEG_BT709_VIDEO_COLOR_ARGS,
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
		`scale_cuda=w=${config.contentWidth}:h=${config.contentHeight}:format=nv12:passthrough=0,hwdownload,format=nv12,${FFMPEG_AUTO_TO_VIDEO_RANGE_FILTER},fps=${config.frameRate},pad=w=${config.width}:h=${config.height}:x=${config.offsetX}:y=${config.offsetY}:color=${backgroundColor}`,
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
		...FFMPEG_BT709_VIDEO_COLOR_ARGS,
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
