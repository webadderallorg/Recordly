import { AudioProcessor } from "../audioEncoder";
import type { ExportResult } from "../types";
import {
	type ExporterHost,
	NATIVE_ENCODER_QUEUE_LIMIT,
	NATIVE_EXPORT_ENGINE_NAME,
	type NativeAudioPlan,
} from "./exporterTypes";
import { awaitWithFinalizationTimeout, reportFinalizingProgress } from "./progress";

export function trackNativeWritePromise(host: ExporterHost, writePromise: Promise<void>): void {
	host.nativeWritePromises.add(writePromise);
	host.peakNativeWriteInFlight = Math.max(
		host.peakNativeWriteInFlight,
		host.nativeWritePromises.size,
	);
	void writePromise.finally(() => {
		host.nativeWritePromises.delete(writePromise);
	});
}

export async function awaitOldestNativeWrite(host: ExporterHost): Promise<void> {
	const oldestWritePromise = host.nativeWritePromises.values().next().value;
	if (!oldestWritePromise) return;
	await oldestWritePromise;
	if (host.nativeWriteError) throw host.nativeWriteError;
}

export async function awaitPendingNativeWrites(host: ExporterHost): Promise<void> {
	while (host.nativeWritePromises.size > 0) {
		await awaitOldestNativeWrite(host);
	}
	if (host.nativeWriteError) throw host.nativeWriteError;
}

export function disposeNativeH264Encoder(host: ExporterHost): void {
	if (!host.nativeH264Encoder) return;
	try {
		host.nativeH264Encoder.close();
	} catch (error) {
		console.debug("[VideoExporter] Ignoring error closing native H.264 encoder:", error);
	}
	host.nativeH264Encoder = null;
}

export async function tryStartNativeVideoExport(host: ExporterHost): Promise<boolean> {
	host.lastNativeExportError = null;

	if (typeof window === "undefined" || !window.electronAPI?.nativeVideoExportStart) {
		host.lastNativeExportError = `${NATIVE_EXPORT_ENGINE_NAME} export is not available in this build.`;
		return false;
	}

	if (host.config.width % 2 !== 0 || host.config.height % 2 !== 0) {
		host.lastNativeExportError = `${NATIVE_EXPORT_ENGINE_NAME} export requires even output dimensions (${host.config.width}x${host.config.height}).`;
		console.warn(
			`[VideoExporter] ${NATIVE_EXPORT_ENGINE_NAME} export requires even output dimensions, falling back to WebCodecs (${host.config.width}x${host.config.height})`,
		);
		return false;
	}

	if (typeof VideoEncoder === "undefined" || typeof VideoEncoder.isConfigSupported !== "function") {
		host.lastNativeExportError = `${NATIVE_EXPORT_ENGINE_NAME} export requires WebCodecs VideoEncoder support.`;
		return false;
	}

	const encoderConfig: VideoEncoderConfig = {
		codec: "avc1.640034",
		width: host.config.width,
		height: host.config.height,
		bitrate: host.config.bitrate,
		framerate: host.config.frameRate,
		hardwareAcceleration: "prefer-hardware",
		avc: { format: "annexb" },
	};

	try {
		const support = await VideoEncoder.isConfigSupported(encoderConfig);
		if (!support.supported) {
			host.lastNativeExportError = `H.264 Annex B encoding is not supported at ${host.config.width}x${host.config.height}.`;
			return false;
		}
	} catch (error) {
		host.lastNativeExportError = error instanceof Error ? error.message : String(error);
		console.warn(
			`[VideoExporter] ${NATIVE_EXPORT_ENGINE_NAME} encoder support check failed`,
			error,
		);
		return false;
	}

	const result = await window.electronAPI.nativeVideoExportStart({
		width: host.config.width,
		height: host.config.height,
		frameRate: host.config.frameRate,
		bitrate: host.config.bitrate,
		encodingMode: host.config.encodingMode ?? "balanced",
		inputMode: "h264-stream",
	});

	if (!result.success || !result.sessionId) {
		host.lastNativeExportError =
			result.error ||
			`${NATIVE_EXPORT_ENGINE_NAME} export could not be started on this system.`;
		console.warn(
			`[VideoExporter] ${NATIVE_EXPORT_ENGINE_NAME} export unavailable`,
			result.error,
		);
		return false;
	}

	host.nativeExportSessionId = result.sessionId;
	host.lastNativeExportError = null;
	host.encodeBackend = "ffmpeg";
	host.encoderName = "h264-stream-copy";

	const sessionId = result.sessionId;
	const encoder = new VideoEncoder({
		output: (chunk) => {
			if (host.cancelled || !host.nativeExportSessionId) return;

			const buffer = new ArrayBuffer(chunk.byteLength);
			chunk.copyTo(buffer);
			const writePromise = window.electronAPI
				.nativeVideoExportWriteFrame(sessionId, new Uint8Array(buffer))
				.then((writeResult) => {
					if (!writeResult.success && !host.cancelled) {
						throw new Error(
							writeResult.error || "Failed to write H.264 chunk to native encoder",
						);
					}
				})
				.catch((error) => {
					if (!host.cancelled) {
						const resolvedError =
							error instanceof Error ? error : new Error(String(error));
						if (!host.nativeEncoderError) host.nativeEncoderError = resolvedError;
						if (!host.nativeWriteError) host.nativeWriteError = resolvedError;
					}
					throw error;
				});

			trackNativeWritePromise(host, writePromise);
		},
		error: (error) => {
			host.nativeEncoderError = error;
		},
	});

	try {
		encoder.configure(encoderConfig);
	} catch (error) {
		host.lastNativeExportError = error instanceof Error ? error.message : String(error);
		try {
			encoder.close();
		} catch (closeError) {
			console.debug(
				"[VideoExporter] Ignoring error closing native H.264 encoder after startup failure:",
				closeError,
			);
		}
		host.nativeExportSessionId = null;
		await window.electronAPI.nativeVideoExportCancel?.(sessionId);
		console.warn(
			`[VideoExporter] ${NATIVE_EXPORT_ENGINE_NAME} encoder configure failed`,
			error,
		);
		return false;
	}

	host.nativeH264Encoder = encoder;
	console.log(
		`[VideoExporter] ${NATIVE_EXPORT_ENGINE_NAME} session ready (H264-stream)`,
		{ sessionId: result.sessionId },
	);
	return true;
}

export async function encodeRenderedFrameNative(
	host: ExporterHost,
	canvas: HTMLCanvasElement | OffscreenCanvas,
	timestamp: number,
	frameDuration: number,
	frameIndex: number,
): Promise<void> {
	if (!host.nativeH264Encoder || !host.nativeExportSessionId) {
		if (host.cancelled) return;
		throw new Error(`${NATIVE_EXPORT_ENGINE_NAME} export session is not active`);
	}
	if (host.nativeEncoderError) throw host.nativeEncoderError;

	while (host.nativeWritePromises.size >= host.maxNativeWriteInFlight) {
		await awaitOldestNativeWrite(host);
		if (host.cancelled) return;
		if (host.nativeEncoderError) throw host.nativeEncoderError;
	}

	while (host.nativeH264Encoder.encodeQueueSize >= NATIVE_ENCODER_QUEUE_LIMIT) {
		await new Promise<void>((r) => setTimeout(r, 2));
		if (host.cancelled) return;
		if (host.nativeEncoderError) throw host.nativeEncoderError;
	}

	const frame = new VideoFrame(canvas, { timestamp, duration: frameDuration });
	host.nativeH264Encoder.encode(frame, { keyFrame: frameIndex % 300 === 0 });
	frame.close();
}

export async function finishNativeVideoExport(
	host: ExporterHost,
	audioPlan: NativeAudioPlan,
): Promise<ExportResult> {
	if (!host.nativeExportSessionId) {
		return {
			success: false,
			error: `${NATIVE_EXPORT_ENGINE_NAME} export session is not active`,
		};
	}

	let editedAudioBuffer: ArrayBuffer | undefined;
	let editedAudioMimeType: string | null = null;

	if (audioPlan.audioMode === "edited-track") {
		host.audioProcessor = new AudioProcessor();
		host.audioProcessor.setOnProgress((progress) => {
			reportFinalizingProgress(host, host.processedFrameCount, 99, progress);
		});
		const audioBlob = await awaitWithFinalizationTimeout(
			host.audioProcessor.renderEditedAudioTrack(
				host.config.videoUrl,
				host.config.trimRegions,
				host.config.speedRegions,
				host.config.audioRegions,
				host.config.sourceAudioFallbackPaths,
			),
			`${NATIVE_EXPORT_ENGINE_NAME} edited audio rendering`,
		);
		editedAudioBuffer = await audioBlob.arrayBuffer();
		editedAudioMimeType = audioBlob.type || null;
	}

	const sessionId = host.nativeExportSessionId;
	host.nativeExportSessionId = null;
	console.log(`[VideoExporter] Finalizing ${NATIVE_EXPORT_ENGINE_NAME} export`, {
		sessionId,
		audioMode: audioPlan.audioMode,
		encoderName: host.encoderName ?? "unknown",
	});

	await awaitPendingNativeWrites(host);

	const result = await awaitWithFinalizationTimeout(
		window.electronAPI.nativeVideoExportFinish(sessionId, {
			audioMode: audioPlan.audioMode,
			audioSourcePath:
				audioPlan.audioMode === "copy-source" || audioPlan.audioMode === "trim-source"
					? audioPlan.audioSourcePath
					: null,
			trimSegments:
				audioPlan.audioMode === "trim-source" ? audioPlan.trimSegments : undefined,
			editedAudioData: editedAudioBuffer,
			editedAudioMimeType,
		}),
		`${NATIVE_EXPORT_ENGINE_NAME} export finalization`,
	);

	if (!result.success) {
		return {
			success: false,
			error: result.error || `Failed to finalize ${NATIVE_EXPORT_ENGINE_NAME} export`,
		};
	}

	host.encoderName = result.encoderName ?? host.encoderName;
	if (!result.data) {
		return {
			success: false,
			error: `${NATIVE_EXPORT_ENGINE_NAME} export did not return video data`,
		};
	}

	const videoBytes = result.data.slice();
	return {
		success: true,
		blob: new Blob([videoBytes.buffer], { type: "video/mp4" }),
	};
}

export async function finalizeExportWithFfmpegAudio(
	host: ExporterHost,
	videoBlob: Blob,
	audioPlan: NativeAudioPlan,
): Promise<ExportResult> {
	if (typeof window === "undefined" || !window.electronAPI?.muxExportedVideoAudio) {
		return {
			success: false,
			error: "FFmpeg audio fallback is unavailable in this environment.",
		};
	}

	let editedAudioBuffer: ArrayBuffer | undefined;
	let editedAudioMimeType: string | null = null;

	if (audioPlan.audioMode === "edited-track") {
		host.audioProcessor = new AudioProcessor();
		host.audioProcessor.setOnProgress((progress) => {
			reportFinalizingProgress(host, host.processedFrameCount, 99, progress);
		});
		const audioBlob = await awaitWithFinalizationTimeout(
			host.audioProcessor.renderEditedAudioTrack(
				host.config.videoUrl,
				host.config.trimRegions,
				host.config.speedRegions,
				host.config.audioRegions,
				host.config.sourceAudioFallbackPaths,
			),
			"FFmpeg edited audio rendering",
		);
		editedAudioBuffer = await audioBlob.arrayBuffer();
		editedAudioMimeType = audioBlob.type || null;
	}

	const videoBuffer = await videoBlob.arrayBuffer();
	const result = await awaitWithFinalizationTimeout(
		window.electronAPI.muxExportedVideoAudio(videoBuffer, {
			audioMode: audioPlan.audioMode,
			audioSourcePath:
				audioPlan.audioMode === "copy-source" || audioPlan.audioMode === "trim-source"
					? audioPlan.audioSourcePath
					: null,
			trimSegments:
				audioPlan.audioMode === "trim-source" ? audioPlan.trimSegments : undefined,
			editedAudioData: editedAudioBuffer,
			editedAudioMimeType,
		}),
		"FFmpeg audio muxing",
	);

	if (!result.success || !result.data) {
		return {
			success: false,
			error: result.error || "Failed to mux exported audio with FFmpeg",
		};
	}

	const videoBytes = result.data.slice();
	return {
		success: true,
		blob: new Blob([videoBytes.buffer], { type: "video/mp4" }),
	};
}
