import { NATIVE_EXPORT_ENGINE_NAME } from "./modernExportConstants";
import type { ModernExportHooks } from "./modernExportHooks";
import type { ModernExportSession } from "./modernExportSession";

type Hooks = Pick<ModernExportHooks, never>;

type Session = Pick<ModernExportSession, "cancelled" | "config" | "flow" | "metrics" | "native">;

export async function tryStartNativeVideoExport(session: Session, hooks: Hooks): Promise<boolean> {
	session.metrics.recordBackendAttempt({ route: "native-stream", status: "attempted" });
	try {
		const selected = await startNativeVideoExport(session, hooks);
		session.metrics.recordBackendAttempt({
			route: "native-stream",
			status: selected ? "selected" : "unavailable",
			reason: selected
				? undefined
				: (session.native.lastNativeExportError ?? "native-stream-unavailable"),
		});
		return selected;
	} catch (error) {
		session.metrics.recordBackendAttempt({
			route: "native-stream",
			status: "failed",
			reason: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}

export async function startNativeVideoExport(session: Session, hooks: Hooks): Promise<boolean> {
	session.native.lastNativeExportError = null;

	if (typeof window === "undefined" || !window.electronAPI?.nativeVideoExportStart) {
		session.native.lastNativeExportError = `${NATIVE_EXPORT_ENGINE_NAME} export is not available in this build.`;
		return false;
	}

	if (session.config.width % 2 !== 0 || session.config.height % 2 !== 0) {
		session.native.lastNativeExportError = `${NATIVE_EXPORT_ENGINE_NAME} export requires even output dimensions (${session.config.width}x${session.config.height}).`;
		console.warn(
			`[VideoExporter] ${NATIVE_EXPORT_ENGINE_NAME} export requires even output dimensions, falling back to WebCodecs (${session.config.width}x${session.config.height})`,
		);
		return false;
	}

	if (
		typeof VideoEncoder === "undefined" ||
		typeof VideoEncoder.isConfigSupported !== "function"
	) {
		return startRawvideoNativeExport(session, hooks, "WebCodecs VideoEncoder is unavailable");
	}

	if (session.native.forceRawvideoNativeRetry) {
		return startRawvideoNativeExport(session, hooks, "Browser H.264 encoding failed");
	}
	let encoderConfig: VideoEncoderConfig = {
		codec: "avc1.640034",
		width: session.config.width,
		height: session.config.height,
		bitrate: session.config.bitrate,
		framerate: session.config.frameRate,
		hardwareAcceleration: "prefer-hardware",
		avc: { format: "annexb" },
		...(session.config.deliveryProfile === "cloud"
			? { bitrateMode: "variable" as const, latencyMode: "quality" as const }
			: {}),
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
				return startRawvideoNativeExport(
					session,
					hooks,
					`H.264 Annex B encoding is not supported at ${session.config.width}x${session.config.height}`,
				);
			}
			encoderConfig = softwareConfig;
		}
	} catch (error) {
		session.native.lastNativeExportError =
			error instanceof Error ? error.message : String(error);
		console.warn(
			`[VideoExporter] ${NATIVE_EXPORT_ENGINE_NAME} encoder support check failed`,
			error,
		);
		return startRawvideoNativeExport(
			session,
			hooks,
			session.native.lastNativeExportError ?? "H.264 support check failed",
		);
	}
	if (session.cancelled) return false;

	const result = await window.electronAPI.nativeVideoExportStart({
		width: session.config.width,
		height: session.config.height,
		frameRate: session.config.frameRate,
		bitrate: session.config.bitrate,
		encodingMode: session.config.encodingMode ?? "balanced",
		inputMode: "h264-stream",
		...(session.config.deliveryProfile === "cloud"
			? { deliveryProfile: "cloud" as const }
			: {}),
	});

	if (session.cancelled) {
		if (result.sessionId) await window.electronAPI.nativeVideoExportCancel?.(result.sessionId);
		return false;
	}
	if (!result.success || !result.sessionId) {
		return startRawvideoNativeExport(
			session,
			hooks,
			result.error || "H.264 stream session could not be started",
		);
	}

	session.native.nativeInputMode = "h264-stream";
	session.native.nativeExportSessionId = result.sessionId;
	session.native.lastNativeExportError = null;
	session.metrics.encodeBackend = "ffmpeg";
	session.metrics.encoderName = "h264-stream-copy";
	session.flow.pendingNativeWriteChunks = [];
	session.flow.pendingNativeWriteBytes = 0;

	const sessionId = result.sessionId;
	const encoder = new VideoEncoder({
		output: (chunk) => {
			if (session.cancelled || session.native.nativeExportSessionId !== sessionId) {
				return;
			}

			const buffer = new ArrayBuffer(chunk.byteLength);
			chunk.copyTo(buffer);
			session.flow.queueNativeWriteChunk(sessionId, new Uint8Array(buffer));
			session.native.nativeOutputChunkCount++;
			session.flow.notifyEncodeCapacityAvailable();
		},
		error: (error) => {
			if (session.native.nativeExportSessionId !== sessionId) return;
			session.native.nativeEncoderError = error;
			session.flow.notifyEncodeCapacityAvailable();
		},
	});

	try {
		encoder.configure(encoderConfig);
	} catch (error) {
		session.native.lastNativeExportError =
			error instanceof Error ? error.message : String(error);
		try {
			encoder.close();
		} catch (closeError) {
			console.debug(
				"[VideoExporter] Ignoring error closing native H.264 encoder after startup failure:",
				closeError,
			);
		}
		session.native.nativeExportSessionId = null;
		await window.electronAPI.nativeVideoExportCancel?.(sessionId);
		console.warn(
			`[VideoExporter] ${NATIVE_EXPORT_ENGINE_NAME} encoder configure failed`,
			error,
		);
		return startRawvideoNativeExport(
			session,
			hooks,
			session.native.lastNativeExportError ?? "H.264 encoder configuration failed",
		);
	}
	encoder.ondequeue = () => {
		if (session.native.nativeExportSessionId === sessionId)
			session.flow.notifyEncodeCapacityAvailable();
	};

	session.metrics.diagnosticEncoder = {
		api: "webcodecs",
		codec: encoderConfig.codec,
		hardwareAcceleration: encoderConfig.hardwareAcceleration,
		hardwareEncoder: "not-exposed-by-webcodecs",
	};
	session.metrics.diagnosticMuxer = "ffmpeg-stream-copy";
	session.native.nativeH264Encoder = encoder;

	console.log(`[VideoExporter] ${NATIVE_EXPORT_ENGINE_NAME} session ready (H264-stream)`, {
		sessionId: result.sessionId,
	});
	return true;
}

export async function startRawvideoNativeExport(
	session: Session,
	_hooks: Hooks,
	reason: string,
): Promise<boolean> {
	if (session.cancelled) return false;
	const result = await window.electronAPI.nativeVideoExportStart({
		width: session.config.width,
		height: session.config.height,
		frameRate: session.config.frameRate,
		bitrate: session.config.bitrate,
		encodingMode: session.config.encodingMode ?? "balanced",
		inputMode: "rawvideo",
		...(session.config.deliveryProfile === "cloud"
			? { deliveryProfile: "cloud" as const }
			: {}),
	});
	if (session.cancelled) {
		if (result.sessionId) await window.electronAPI.nativeVideoExportCancel?.(result.sessionId);
		return false;
	}
	if (!result.success || !result.sessionId) {
		session.native.lastNativeExportError = `${reason}. Bundled FFmpeg rawvideo fallback: ${result.error || "unavailable"}`;
		return false;
	}
	session.native.nativeInputMode = "rawvideo";
	session.native.nativeExportSessionId = result.sessionId;
	session.metrics.encodeBackend = "ffmpeg";
	session.metrics.encoderName = result.encoderName ?? "ffmpeg-rawvideo";
	session.native.lastNativeExportError = null;
	session.metrics.diagnosticEncoder = {
		api: "ffmpeg",
		codec: "h264",
		hardwareEncoder: session.metrics.encoderName,
	};
	session.metrics.diagnosticMuxer = "ffmpeg-rawvideo";
	session.flow.pendingNativeWriteChunks = [];
	session.flow.pendingNativeWriteBytes = 0;
	console.log("[VideoExporter] Using bundled FFmpeg rawvideo fallback", {
		reason,
		encoderName: session.metrics.encoderName,
	});
	return true;
}
