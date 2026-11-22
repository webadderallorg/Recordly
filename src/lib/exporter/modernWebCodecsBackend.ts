import {
	getPreferredWebCodecsLatencyModes,
	getWebCodecsEncodeQueueLimit,
	getWebCodecsKeyFrameInterval,
} from "./exportTuning";
import { ENCODER_PROGRESS_TIMEOUT_MS, getNowMs } from "./modernExportConstants";
import { markWebCodecsEncoderFailure } from "./modernExportEncoderFailure";
import type { ModernExportHooks } from "./modernExportHooks";
import type { ModernExportSession } from "./modernExportSession";
import {
	getOrderedSupportedMp4EncoderCandidates,
	type SupportedMp4EncoderPath,
} from "./mp4Support";
import { ENCODED_H264_COLOR_SPACE_FALLBACK, EXPORT_CANVAS_COLOR_SPACE } from "./videoColorSpace";

type Hooks = Pick<ModernExportHooks, never>;

type Session = Pick<
	ModernExportSession,
	| "backpressureProfile"
	| "browser"
	| "cancelled"
	| "config"
	| "flow"
	| "metrics"
	| "throwIfCancelled"
>;

export async function encodeRenderedFrame(
	session: Session,
	_hooks: Hooks,
	timestamp: number,
	frameDuration: number,
	frameIndex: number,
): Promise<void> {
	let idleSince = getNowMs();
	let previousBacklog = session.flow.getCurrentEncodeBacklog();
	while (
		session.browser.encoder &&
		session.flow.getCurrentEncodeBacklog() >= session.flow.webCodecsEncodeQueueLimit &&
		!session.cancelled
	) {
		const encodeWaitStartedAt = getNowMs();
		session.metrics.encodeWaitEvents++;
		await session.flow.waitForEncodeCapacity();
		session.metrics.encodeWaitTimeMs += getNowMs() - encodeWaitStartedAt;
		const backlog = session.flow.getCurrentEncodeBacklog();
		if (backlog < previousBacklog) idleSince = getNowMs();
		if (getNowMs() - idleSince >= ENCODER_PROGRESS_TIMEOUT_MS) {
			throw new Error("WebCodecs encoder made no progress for 30 seconds");
		}
		previousBacklog = backlog;
	}

	session.throwIfCancelled();
	const canvas = session.browser.renderer!.getCanvas();

	// @ts-expect-error - colorSpace not in TypeScript definitions but works at runtime
	const exportFrame = new VideoFrame(canvas, {
		timestamp,
		duration: frameDuration,
		colorSpace: EXPORT_CANVAS_COLOR_SPACE,
	});

	try {
		if (session.browser.encoder && session.browser.encoder.state === "configured") {
			session.metrics.peakEncodeQueueSize = Math.max(
				session.metrics.peakEncodeQueueSize,
				session.browser.encoder.encodeQueueSize,
				session.flow.encodeQueue,
			);
			session.flow.encodeQueue++;
			session.browser.encoder.encode(exportFrame, {
				keyFrame: frameIndex % Math.max(session.flow.keyFrameInterval, 1) === 0,
			});
			session.metrics.peakEncodeQueueSize = Math.max(
				session.metrics.peakEncodeQueueSize,
				session.browser.encoder.encodeQueueSize,
				session.flow.encodeQueue,
			);
		} else {
			console.warn(
				`[Frame ${frameIndex}] Encoder not ready! State: ${session.browser.encoder?.state}`,
			);
		}
	} catch (error) {
		throw markWebCodecsEncoderFailure(error);
	} finally {
		exportFrame.close();
	}
}

export async function initializeEncoder(
	session: Session,
	hooks: Hooks,
): Promise<SupportedMp4EncoderPath> {
	session.metrics.recordBackendAttempt({ route: "webcodecs", status: "attempted" });
	session.flow.encodeQueue = 0;
	session.flow.webCodecsEncodeQueueLimit =
		session.config.maxEncodeQueue ??
		session.backpressureProfile?.maxEncodeQueue ??
		getWebCodecsEncodeQueueLimit(session.config.frameRate, session.config.encodingMode);
	session.flow.keyFrameInterval = getWebCodecsKeyFrameInterval(
		session.config.frameRate,
		session.config.encodingMode,
	);
	session.flow.pendingMuxing = Promise.resolve();
	session.flow.chunkCount = 0;
	let videoDescription: Uint8Array | undefined;

	const encoderCandidates = getEncoderCandidates(session, hooks);
	const latencyModePreferences = getPreferredWebCodecsLatencyModes(session.config.encodingMode);

	let resolvedCodec: string | null = null;

	console.log("[VideoExporter] WebCodecs tuning", {
		encodingMode: session.config.encodingMode ?? "balanced",
		keyFrameInterval: session.flow.keyFrameInterval,
		latencyModes: latencyModePreferences,
		queueLimit: session.flow.webCodecsEncodeQueueLimit,
	});

	session.browser.encoder = new VideoEncoder({
		output: (chunk, meta) => {
			// Capture decoder config metadata from encoder output
			if (meta?.decoderConfig?.description && !videoDescription) {
				const desc = meta.decoderConfig.description;
				videoDescription = ArrayBuffer.isView(desc)
					? new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength)
					: new Uint8Array(desc);
				session.browser.videoDescription = videoDescription;
			}
			// Capture colorSpace from encoder metadata if provided
			if (meta?.decoderConfig?.colorSpace && !session.browser.videoColorSpace) {
				session.browser.videoColorSpace = meta.decoderConfig.colorSpace;
			}

			// Stream chunks to muxer in order without retaining an ever-growing promise array
			const isFirstChunk = session.flow.chunkCount === 0;
			session.flow.chunkCount++;

			session.flow.pendingMuxing = session.flow.pendingMuxing.then(async () => {
				try {
					if (isFirstChunk && session.browser.videoDescription) {
						// Add decoder config for the first chunk
						const colorSpace =
							session.browser.videoColorSpace || ENCODED_H264_COLOR_SPACE_FALLBACK;

						const metadata: EncodedVideoChunkMetadata = {
							decoderConfig: {
								codec: resolvedCodec ?? (session.config.codec || "avc1.640033"),
								codedWidth: session.config.width,
								codedHeight: session.config.height,
								description: session.browser.videoDescription,
								colorSpace,
							},
						};

						await session.browser.muxer!.addVideoChunk(chunk, metadata);
					} else {
						await session.browser.muxer!.addVideoChunk(chunk, meta);
					}
				} catch (error) {
					console.error("Muxing error:", error);
					const muxingError = error instanceof Error ? error : new Error(String(error));
					if (!session.browser.encoderError) {
						session.browser.encoderError = muxingError;
					}
					session.cancelled = true;
				}
			});
			session.flow.encodeQueue--;
			session.flow.notifyEncodeCapacityAvailable();
		},
		error: (error) => {
			console.error(
				`[VideoExporter] Encoder error (codec: ${resolvedCodec}, ${session.config.width}x${session.config.height}):`,
				error,
			);
			session.browser.encoderError = markWebCodecsEncoderFailure(error);
			session.cancelled = true;
			session.flow.notifyEncodeCapacityAvailable();
		},
	});

	const baseConfig: Omit<VideoEncoderConfig, "codec" | "hardwareAcceleration" | "latencyMode"> = {
		width: session.config.width,
		height: session.config.height,
		bitrate: session.config.bitrate,
		framerate: session.config.frameRate,
		bitrateMode: "variable",
	};

	for (const candidate of encoderCandidates) {
		for (const latencyMode of latencyModePreferences) {
			const config: VideoEncoderConfig = {
				...baseConfig,
				codec: candidate.codec,
				hardwareAcceleration: candidate.hardwareAcceleration,
				latencyMode,
			};
			let support: VideoEncoderSupport;
			try {
				support = await VideoEncoder.isConfigSupported(config);
			} catch (error) {
				session.metrics.recordBackendAttempt({
					route: "webcodecs",
					status: "failed",
					codec: config.codec,
					hardwareAcceleration: config.hardwareAcceleration,
					latencyMode,
					reason: error instanceof Error ? error.message : String(error),
				});
				throw error;
			}
			if (support.supported) {
				resolvedCodec = candidate.codec;
				session.metrics.encodeBackend = "webcodecs";
				session.metrics.encoderName = `${candidate.codec}/${candidate.hardwareAcceleration}/${latencyMode}`;
				console.log(
					`[VideoExporter] Using ${candidate.hardwareAcceleration} ${latencyMode} encoder path with codec ${candidate.codec}`,
				);
				try {
					session.browser.encoder.configure(config);
				} catch (error) {
					session.metrics.recordBackendAttempt({
						route: "webcodecs",
						status: "failed",
						codec: config.codec,
						hardwareAcceleration: config.hardwareAcceleration,
						latencyMode,
						reason: error instanceof Error ? error.message : String(error),
					});
					throw markWebCodecsEncoderFailure(error);
				}
				session.metrics.diagnosticEncoder = {
					api: "webcodecs",
					codec: config.codec,
					hardwareAcceleration: config.hardwareAcceleration,
					latencyMode: config.latencyMode,
					hardwareEncoder: "not-exposed-by-webcodecs",
				};
				session.metrics.diagnosticMuxer = "mediabunny";
				session.metrics.recordBackendAttempt({
					route: "webcodecs",
					status: "selected",
					codec: config.codec,
					hardwareAcceleration: config.hardwareAcceleration,
					latencyMode,
				});
				return candidate;
			}

			session.metrics.recordBackendAttempt({
				route: "webcodecs",
				status: "unavailable",
				codec: config.codec,
				hardwareAcceleration: config.hardwareAcceleration,
				latencyMode,
				reason: "config-not-supported",
			});
			console.warn(
				`[VideoExporter] Encoder path ${candidate.codec}/${candidate.hardwareAcceleration}/${latencyMode} is not supported (${session.config.width}x${session.config.height}), trying next...`,
			);
		}
	}

	throw new Error(
		`Video encoding not supported on this system. ` +
			`Tried encoder paths: ${encoderCandidates
				.map((candidate) => `${candidate.codec}/${candidate.hardwareAcceleration}`)
				.join(", ")} at ${session.config.width}x${session.config.height}. ` +
			`Your browser or hardware may not support H.264 encoding at this resolution. ` +
			`Try exporting at a lower quality setting.`,
	);
}

export function getEncoderCandidates(session: Session, _hooks: Hooks): SupportedMp4EncoderPath[] {
	const candidates = getOrderedSupportedMp4EncoderCandidates({
		codec: session.config.codec,
		preferredEncoderPath: session.config.preferredEncoderPath,
	});
	return session.config.forceSoftwareEncoding
		? candidates.filter((candidate) => candidate.hardwareAcceleration === "prefer-software")
		: candidates;
}
