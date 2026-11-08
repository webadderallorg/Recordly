import path from "node:path";
import { type NativeVideoMetadataProbe, probeNativeVideoMetadata } from "../../ffmpeg/metadata";
import {
	NATIVE_STATIC_LAYOUT_SOURCE_PROXY_1080P30_BITRATE,
	NATIVE_STATIC_LAYOUT_SOURCE_PROXY_CONTAINERS,
	NATIVE_STATIC_LAYOUT_SOURCE_PROXY_MAX_BITRATE,
	NATIVE_STATIC_LAYOUT_SOURCE_PROXY_REFERENCE_PIXEL_RATE,
} from "./constants";
import { formatCliNumber, getFfmpegFailureMessage } from "./layout";
import { runFfmpegWithMetrics } from "./process";
import { validateNativeStaticLayoutTimelineSegments } from "./timeline";
import {
	type NativeStaticLayoutExportOptions,
	type NativeStaticLayoutExportSession,
} from "./types";

export function isNativeStaticLayoutH264SourceCodec(codec: string | undefined) {
	const normalized = (codec ?? "").trim().toLowerCase();
	return (
		/\bh\.?264\b/.test(normalized) ||
		normalized.includes("avc1") ||
		normalized.includes("avc3") ||
		normalized.includes("mpeg-4 avc")
	);
}

export function shouldCreateNativeStaticLayoutSourceProxy(
	metadata: Pick<NativeVideoMetadataProbe, "codec">,
	inputPath: string,
) {
	const extension = path.extname(inputPath).toLowerCase();
	return (
		!isNativeStaticLayoutH264SourceCodec(metadata.codec) ||
		!NATIVE_STATIC_LAYOUT_SOURCE_PROXY_CONTAINERS.has(extension)
	);
}

export function getNativeStaticLayoutSourceProxyBitrate(
	options: Pick<NativeStaticLayoutExportOptions, "bitrate" | "frameRate" | "width" | "height">,
	metadata?: Pick<NativeVideoMetadataProbe, "width" | "height">,
) {
	const frameRate = Math.max(1, Math.round(options.frameRate));
	const width = Math.max(1, Math.round(metadata?.width ?? options.width));
	const height = Math.max(1, Math.round(metadata?.height ?? options.height));
	const pixelRateScale = Math.sqrt(
		(width * height * frameRate) / NATIVE_STATIC_LAYOUT_SOURCE_PROXY_REFERENCE_PIXEL_RATE,
	);
	const qualityFloor = Math.round(
		NATIVE_STATIC_LAYOUT_SOURCE_PROXY_1080P30_BITRATE * pixelRateScale,
	);
	return Math.min(
		NATIVE_STATIC_LAYOUT_SOURCE_PROXY_MAX_BITRATE,
		Math.max(Math.round(options.bitrate * 1.2), qualityFloor),
	);
}

export function buildNativeStaticLayoutSourceProxyArgs(
	options: NativeStaticLayoutExportOptions,
	outputPath: string,
	metadata: NativeVideoMetadataProbe,
) {
	const frameRate = Math.max(1, Math.round(options.frameRate));
	const sourceDurationSec = Math.max(
		0.001,
		metadata.streamDuration ?? metadata.duration ?? options.durationSec,
	);
	const proxyBitrate = getNativeStaticLayoutSourceProxyBitrate(options, metadata);
	return [
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		"-i",
		options.inputPath,
		"-map",
		"0:v:0",
		"-an",
		"-t",
		formatCliNumber(sourceDurationSec),
		"-vf",
		`fps=fps=${frameRate}:start_time=0,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1,format=yuv420p,setpts=PTS-STARTPTS`,
		"-c:v",
		"libx264",
		"-preset",
		"veryfast",
		"-tune",
		"zerolatency",
		"-g",
		String(Math.max(1, Math.round(frameRate * 2))),
		"-b:v",
		String(proxyBitrate),
		"-maxrate",
		String(Math.round(proxyBitrate * 1.25)),
		"-bufsize",
		String(proxyBitrate * 2),
		"-pix_fmt",
		"yuv420p",
		"-movflags",
		"+faststart",
		outputPath,
	];
}

export function validateNativeStaticLayoutSourceProxyMetadata(
	metadata: NativeVideoMetadataProbe,
	expected: { sourceDurationSec: number },
) {
	const issues: string[] = [];
	const expectedDurationSec = Math.max(0, expected.sourceDurationSec);
	const durationToleranceSec = Math.min(2, Math.max(0.5, expectedDurationSec * 0.03));
	if (!isNativeStaticLayoutH264SourceCodec(metadata.codec)) {
		issues.push(`proxy codec is not H.264/AVC: ${metadata.codec || "unknown"}`);
	}
	if (!Number.isFinite(metadata.duration) || metadata.duration <= 0) {
		issues.push("proxy duration is unavailable");
	} else if (metadata.duration + durationToleranceSec < expectedDurationSec) {
		issues.push(
			`proxy duration ${metadata.duration.toFixed(
				3,
			)}s shorter than expected ${expectedDurationSec.toFixed(3)}s`,
		);
	}
	return issues;
}

export function shouldCreateWindowsGpuWebcamProxy(filePath: string) {
	const extension = path.extname(filePath).toLowerCase();
	return extension !== ".mp4" && extension !== ".m4v" && extension !== ".mov";
}

function getWindowsGpuWebcamProxyDuration(options: NativeStaticLayoutExportOptions) {
	const segments = validateNativeStaticLayoutTimelineSegments(
		options.timelineSegments,
		options.durationSec,
	);
	const offsetMs = options.webcamTimeOffsetMs ?? 0;
	if (!Number.isFinite(offsetMs)) throw new Error("Webcam time offset must be finite");
	// The native compositor maps output time back to source time, then subtracts
	// this offset. Preserve every required source sample, even after trims/speed
	// edits, while retaining at least the original unedited proxy coverage.
	let sourceEndMs = options.durationSec * 1000;
	for (const segment of segments) sourceEndMs = Math.max(sourceEndMs, segment.sourceEndMs);
	return Math.max(options.durationSec, (sourceEndMs - offsetMs) / 1000);
}

export function buildWindowsGpuWebcamProxyArgs(
	options: NativeStaticLayoutExportOptions,
	outputPath: string,
) {
	if (!options.webcamInputPath) {
		throw new Error("Windows GPU webcam proxy requires an input path");
	}

	const frameRate = Math.max(1, Math.round(options.frameRate));
	const proxyBitrate = Math.max(2_000_000, Math.min(6_000_000, Math.round(options.bitrate / 3)));
	return [
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		"-i",
		options.webcamInputPath,
		"-map",
		"0:v:0",
		"-an",
		"-t",
		formatCliNumber(getWindowsGpuWebcamProxyDuration(options)),
		"-vf",
		`scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1,fps=${frameRate}`,
		"-c:v",
		"libx264",
		"-preset",
		"ultrafast",
		"-tune",
		"zerolatency",
		"-b:v",
		String(proxyBitrate),
		"-maxrate",
		String(Math.round(proxyBitrate * 1.2)),
		"-bufsize",
		String(proxyBitrate * 2),
		"-pix_fmt",
		"yuv420p",
		"-movflags",
		"+faststart",
		outputPath,
	];
}

export async function prepareWindowsGpuWebcamInput(
	ffmpegPath: string,
	options: NativeStaticLayoutExportOptions,
	outputPath: string,
	session: NativeStaticLayoutExportSession,
) {
	if (!options.webcamInputPath || !shouldCreateWindowsGpuWebcamProxy(options.webcamInputPath)) {
		return { inputPath: options.webcamInputPath ?? null, elapsedMs: 0 };
	}

	const result = await runFfmpegWithMetrics(
		ffmpegPath,
		buildWindowsGpuWebcamProxyArgs(options, outputPath),
		Math.min(
			2_147_483_647,
			Math.max(5 * 60 * 1000, getWindowsGpuWebcamProxyDuration(options) * 1000),
		),
		session,
	);
	if (!result.success) {
		throw new Error(getFfmpegFailureMessage(result));
	}

	return { inputPath: outputPath, elapsedMs: result.elapsedMs };
}

export async function prepareNativeStaticLayoutSourceInput(
	ffmpegPath: string,
	options: NativeStaticLayoutExportOptions,
	outputPath: string,
	session: NativeStaticLayoutExportSession,
) {
	const metadata = await probeNativeVideoMetadata(ffmpegPath, options.inputPath);
	if (!shouldCreateNativeStaticLayoutSourceProxy(metadata, options.inputPath)) {
		return {
			inputPath: options.inputPath,
			elapsedMs: 0,
			sourceCodec: metadata.codec,
			proxyCreated: false,
		};
	}

	const sourceDurationSec = Math.max(
		0.001,
		metadata.streamDuration ?? metadata.duration ?? options.durationSec,
	);
	const result = await runFfmpegWithMetrics(
		ffmpegPath,
		buildNativeStaticLayoutSourceProxyArgs(options, outputPath, metadata),
		Math.max(5 * 60 * 1000, sourceDurationSec * 2000),
		session,
	);
	if (!result.success) {
		throw new Error(getFfmpegFailureMessage(result));
	}

	const proxyMetadata = await probeNativeVideoMetadata(ffmpegPath, outputPath);
	const validationIssues = validateNativeStaticLayoutSourceProxyMetadata(proxyMetadata, {
		sourceDurationSec,
	});
	if (validationIssues.length > 0) {
		throw new Error(`Native source proxy is invalid: ${validationIssues.join("; ")}`);
	}

	return {
		inputPath: outputPath,
		elapsedMs: result.elapsedMs,
		sourceCodec: metadata.codec,
		proxyCodec: proxyMetadata.codec,
		proxyCreated: true,
	};
}
