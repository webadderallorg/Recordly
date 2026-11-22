import type { LegacyVideoExporterContext } from "./legacyVideoExporterContext";
import { DEFAULT_MAX_ENCODE_QUEUE } from "./legacyVideoExporterContext";
import { EXPORT_CANVAS_COLOR_SPACE } from "./videoColorSpace";

export function shouldUseExperimentalNativeExport(
	_context: Pick<LegacyVideoExporterContext, never>,
): boolean {
	return (
		typeof window !== "undefined" &&
		typeof VideoEncoder !== "undefined" &&
		typeof VideoEncoder.isConfigSupported === "function" &&
		typeof window.electronAPI?.nativeVideoExportStart === "function" &&
		typeof window.electronAPI?.nativeVideoExportWriteFrame === "function" &&
		typeof window.electronAPI?.nativeVideoExportFinish === "function" &&
		typeof window.electronAPI?.nativeVideoExportCancel === "function"
	);
}

export async function tryStartNativeVideoExport(
	context: Pick<
		LegacyVideoExporterContext,
		| "shouldUseExperimentalNativeExport"
		| "config"
		| "nativeExportSessionId"
		| "nativePendingWrite"
		| "nativeWritePromises"
		| "nativeWriteError"
		| "maxNativeWriteInFlight"
		| "cancelled"
		| "nativeEncoderError"
		| "trackNativeWritePromise"
		| "nativeH264Encoder"
	>,
): Promise<boolean> {
	if (!context.shouldUseExperimentalNativeExport()) {
		return false;
	}

	if (context.config.width % 2 !== 0 || context.config.height % 2 !== 0) {
		console.warn(
			`[VideoExporter] Native export requires even output dimensions, falling back to WebCodecs (${context.config.width}x${context.config.height})`,
		);
		return false;
	}

	let encoderConfig: VideoEncoderConfig = {
		codec: "avc1.640034",
		width: context.config.width,
		height: context.config.height,
		bitrate: context.config.bitrate,
		framerate: context.config.frameRate,
		hardwareAcceleration: "prefer-hardware",
		avc: { format: "annexb" },
	};

	try {
		const support = await VideoEncoder.isConfigSupported(encoderConfig);
		if (!support.supported) {
			const softwareConfig: VideoEncoderConfig = {
				...encoderConfig,
				hardwareAcceleration: "prefer-software",
			};
			const softwareSupport = await VideoEncoder.isConfigSupported(softwareConfig);
			if (!softwareSupport.supported) {
				console.warn(
					`[VideoExporter] Native H.264 Annex B encoding is unsupported at ${context.config.width}x${context.config.height}`,
				);
				return false;
			}
			encoderConfig = softwareConfig;
		}
	} catch (error) {
		console.warn("[VideoExporter] Native encoder support check failed:", error);
		return false;
	}

	const result = await window.electronAPI.nativeVideoExportStart({
		width: context.config.width,
		height: context.config.height,
		frameRate: context.config.frameRate,
		bitrate: context.config.bitrate,
		encodingMode: context.config.encodingMode ?? "balanced",
		inputMode: "h264-stream",
	});

	if (!result.success || !result.sessionId) {
		console.warn("[VideoExporter] Native export unavailable", result.error);
		return false;
	}

	context.nativeExportSessionId = result.sessionId;
	context.nativePendingWrite = Promise.resolve();
	context.nativeWritePromises = new Set();
	context.nativeWriteError = null;
	context.maxNativeWriteInFlight = Math.max(
		1,
		Math.floor(context.config.maxInFlightNativeWrites ?? 1),
	);

	// Initialize the browser-side H.264 encoder (hardware-accelerated where available).
	// Encoded Annex B chunks are sent over IPC and FFmpeg stream-copies them into MP4.
	const sessionId = result.sessionId;
	const encoder = new VideoEncoder({
		output: (chunk) => {
			if (context.cancelled || !context.nativeExportSessionId) return;
			const buffer = new ArrayBuffer(chunk.byteLength);
			chunk.copyTo(buffer);
			const writePromise = context.nativePendingWrite
				.then(async () => {
					const writeResult = await window.electronAPI.nativeVideoExportWriteFrame(
						sessionId,
						new Uint8Array(buffer),
					);
					if (!writeResult.success && !context.cancelled) {
						throw new Error(
							writeResult.error || "Failed to write H.264 chunk to native encoder",
						);
					}
				})
				.catch((error) => {
					if (!context.cancelled && !context.nativeEncoderError) {
						context.nativeEncoderError =
							error instanceof Error ? error : new Error(String(error));
					}
					if (!context.cancelled && !context.nativeWriteError) {
						context.nativeWriteError =
							error instanceof Error ? error : new Error(String(error));
					}
				});
			context.nativePendingWrite = writePromise;
			context.trackNativeWritePromise(writePromise);
		},
		error: (e) => {
			context.nativeEncoderError = e;
		},
	});

	try {
		encoder.configure(encoderConfig);
	} catch (error) {
		context.nativeEncoderError = error instanceof Error ? error : new Error(String(error));
		try {
			encoder.close();
		} catch (closeError) {
			console.debug(
				"[VideoExporter] Ignoring error closing native encoder after startup failure:",
				closeError,
			);
		}
		context.nativeExportSessionId = null;
		await window.electronAPI.nativeVideoExportCancel(sessionId);
		return false;
	}

	context.nativeH264Encoder = encoder;
	return true;
}

export async function encodeRenderedFrameNative(
	context: Pick<
		LegacyVideoExporterContext,
		| "nativeH264Encoder"
		| "nativeExportSessionId"
		| "cancelled"
		| "nativeEncoderError"
		| "nativeWriteError"
		| "nativeWritePromises"
		| "maxNativeWriteInFlight"
		| "awaitOldestNativeWrite"
		| "config"
		| "renderer"
	>,
	timestamp: number,
	frameDuration: number,
	frameIndex: number,
): Promise<void> {
	if (!context.nativeH264Encoder || !context.nativeExportSessionId) {
		if (context.cancelled) return;
		throw new Error("Native export session is not active");
	}

	if (context.nativeEncoderError) throw context.nativeEncoderError;
	if (context.nativeWriteError) throw context.nativeWriteError;

	while (
		context.nativeWritePromises.size >= context.maxNativeWriteInFlight &&
		!context.cancelled
	) {
		await context.awaitOldestNativeWrite();
		if (context.nativeEncoderError) throw context.nativeEncoderError;
		if (context.nativeWriteError) throw context.nativeWriteError;
	}

	// Apply backpressure: don't queue too far ahead of FFmpeg's stdin pipe
	while (
		context.nativeH264Encoder.encodeQueueSize >=
		Math.max(1, Math.floor(context.config.maxEncodeQueue ?? DEFAULT_MAX_ENCODE_QUEUE))
	) {
		await new Promise<void>((r) => setTimeout(r, 2));
		if (context.cancelled) return;
		if (context.nativeEncoderError) throw context.nativeEncoderError;
		if (context.nativeWriteError) throw context.nativeWriteError;
	}

	const canvas = context.renderer!.getCanvas();
	// @ts-expect-error - colorSpace not in TypeScript definitions but works at runtime
	const frame = new VideoFrame(canvas, {
		timestamp,
		duration: frameDuration,
		colorSpace: EXPORT_CANVAS_COLOR_SPACE,
	});
	context.nativeH264Encoder.encode(frame, { keyFrame: frameIndex % 300 === 0 });
	frame.close();
}

export function trackNativeWritePromise(
	context: Pick<LegacyVideoExporterContext, "nativeWritePromises">,
	writePromise: Promise<void>,
): void {
	context.nativeWritePromises.add(writePromise);

	void writePromise.finally(() => {
		context.nativeWritePromises.delete(writePromise);
	});
}

export async function awaitOldestNativeWrite(
	context: Pick<
		LegacyVideoExporterContext,
		"nativeWritePromises" | "awaitWithFinalizationTimeout" | "nativeWriteError"
	>,
): Promise<void> {
	const oldestWritePromise = context.nativeWritePromises.values().next().value;
	if (!oldestWritePromise) {
		return;
	}

	await context.awaitWithFinalizationTimeout(oldestWritePromise, "native frame write");

	if (context.nativeWriteError) {
		throw context.nativeWriteError;
	}
}

export async function awaitPendingNativeWrites(
	context: Pick<
		LegacyVideoExporterContext,
		"nativeWritePromises" | "awaitOldestNativeWrite" | "nativeWriteError"
	>,
): Promise<void> {
	while (context.nativeWritePromises.size > 0) {
		await context.awaitOldestNativeWrite();
	}

	if (context.nativeWriteError) {
		throw context.nativeWriteError;
	}
}
