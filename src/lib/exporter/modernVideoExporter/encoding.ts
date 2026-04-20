import {
	getExportBackpressureProfile,
	getPreferredWebCodecsLatencyModes,
	getWebCodecsEncodeQueueLimit,
	getWebCodecsKeyFrameInterval,
} from "../exportTuning";
import {
	getOrderedSupportedMp4EncoderCandidates,
	type SupportedMp4EncoderPath,
} from "../mp4Support";
import type { ExporterHost } from "./exporterTypes";
import { getNowMs } from "./progress";

export { getExportBackpressureProfile };

export function getEncoderCandidates(host: ExporterHost): SupportedMp4EncoderPath[] {
	return getOrderedSupportedMp4EncoderCandidates({
		codec: host.config.codec,
		preferredEncoderPath: host.config.preferredEncoderPath,
	});
}

export async function initializeEncoder(host: ExporterHost): Promise<SupportedMp4EncoderPath> {
	host.encodeQueue = 0;
	host.webCodecsEncodeQueueLimit =
		host.config.maxEncodeQueue ??
		host.backpressureProfile?.maxEncodeQueue ??
		getWebCodecsEncodeQueueLimit(host.config.frameRate, host.config.encodingMode);
	host.keyFrameInterval = getWebCodecsKeyFrameInterval(
		host.config.frameRate,
		host.config.encodingMode,
	);
	host.pendingMuxing = Promise.resolve();
	host.chunkCount = 0;
	let videoDescription: Uint8Array | undefined;

	const encoderCandidates = getEncoderCandidates(host);
	const latencyModePreferences = getPreferredWebCodecsLatencyModes(host.config.encodingMode);

	let resolvedCodec: string | null = null;

	console.log("[VideoExporter] WebCodecs tuning", {
		encodingMode: host.config.encodingMode ?? "balanced",
		keyFrameInterval: host.keyFrameInterval,
		latencyModes: latencyModePreferences,
		queueLimit: host.webCodecsEncodeQueueLimit,
	});

	host.encoder = new VideoEncoder({
		output: (chunk, meta) => {
			if (meta?.decoderConfig?.description && !videoDescription) {
				const desc = meta.decoderConfig.description;
				videoDescription = ArrayBuffer.isView(desc)
					? new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength)
					: new Uint8Array(desc);
				host.videoDescription = videoDescription;
			}
			if (meta?.decoderConfig?.colorSpace && !host.videoColorSpace) {
				host.videoColorSpace = meta.decoderConfig.colorSpace;
			}

			const isFirstChunk = host.chunkCount === 0;
			host.chunkCount++;

			host.pendingMuxing = host.pendingMuxing.then(async () => {
				try {
					if (isFirstChunk && host.videoDescription) {
						const colorSpace = host.videoColorSpace || {
							primaries: "bt709",
							transfer: "iec61966-2-1",
							matrix: "rgb",
							fullRange: true,
						};
						const metadata: EncodedVideoChunkMetadata = {
							decoderConfig: {
								codec: resolvedCodec ?? (host.config.codec || "avc1.640033"),
								codedWidth: host.config.width,
								codedHeight: host.config.height,
								description: host.videoDescription,
								colorSpace,
							},
						};
						await host.muxer!.addVideoChunk(chunk, metadata);
					} else {
						await host.muxer!.addVideoChunk(chunk, meta);
					}
				} catch (error) {
					console.error("Muxing error:", error);
					const muxingError =
						error instanceof Error ? error : new Error(String(error));
					if (!host.encoderError) {
						host.encoderError = muxingError;
					}
					host.cancelled = true;
				}
			});
			host.encodeQueue--;
		},
		error: (error) => {
			console.error(
				`[VideoExporter] Encoder error (codec: ${resolvedCodec}, ${host.config.width}x${host.config.height}):`,
				error,
			);
			host.encoderError = error instanceof Error ? error : new Error(String(error));
			host.cancelled = true;
		},
	});

	const baseConfig: Omit<
		VideoEncoderConfig,
		"codec" | "hardwareAcceleration" | "latencyMode"
	> = {
		width: host.config.width,
		height: host.config.height,
		bitrate: host.config.bitrate,
		framerate: host.config.frameRate,
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
			const support = await VideoEncoder.isConfigSupported(config);
			if (support.supported) {
				resolvedCodec = candidate.codec;
				host.encodeBackend = "webcodecs";
				host.encoderName = `${candidate.codec}/${candidate.hardwareAcceleration}/${latencyMode}`;
				console.log(
					`[VideoExporter] Using ${candidate.hardwareAcceleration} ${latencyMode} encoder path with codec ${candidate.codec}`,
				);
				host.encoder.configure(config);
				return candidate;
			}

			console.warn(
				`[VideoExporter] Encoder path ${candidate.codec}/${candidate.hardwareAcceleration}/${latencyMode} is not supported (${host.config.width}x${host.config.height}), trying next...`,
			);
		}
	}

	throw new Error(
		`Video encoding not supported on this system. ` +
			`Tried encoder paths: ${encoderCandidates
				.map((c) => `${c.codec}/${c.hardwareAcceleration}`)
				.join(", ")} at ${host.config.width}x${host.config.height}. ` +
			`Your browser or hardware may not support H.264 encoding at this resolution. ` +
			`Try exporting at a lower quality setting.`,
	);
}

export function disposeEncoder(host: ExporterHost): void {
	if (!host.encoder) return;
	try {
		if (host.encoder.state !== "closed") {
			host.encoder.close();
		}
	} catch (error) {
		console.warn("Error closing encoder:", error);
	}
	host.encoder = null;
	host.encodeQueue = 0;
	host.pendingMuxing = Promise.resolve();
	host.chunkCount = 0;
	host.videoDescription = undefined;
	host.videoColorSpace = undefined;
	host.webCodecsEncodeQueueLimit = 0;
	host.keyFrameInterval = 0;
	host.encodeBackend = null;
	host.encoderName = null;
}

export async function encodeRenderedFrame(
	host: ExporterHost,
	canvas: HTMLCanvasElement | OffscreenCanvas,
	timestamp: number,
	frameDuration: number,
	frameIndex: number,
): Promise<void> {
	// @ts-expect-error - colorSpace not in TypeScript definitions but works at runtime
	const exportFrame = new VideoFrame(canvas, {
		timestamp,
		duration: frameDuration,
		colorSpace: {
			primaries: "bt709",
			transfer: "iec61966-2-1",
			matrix: "rgb",
			fullRange: true,
		},
	});

	while (
		host.encoder &&
		getCurrentEncodeBacklog(host) >= host.webCodecsEncodeQueueLimit &&
		!host.cancelled
	) {
		const encodeWaitStartedAt = getNowMs();
		host.encodeWaitEvents++;
		await new Promise((resolve) => setTimeout(resolve, 2));
		host.encodeWaitTimeMs += getNowMs() - encodeWaitStartedAt;
	}

	try {
		if (host.encoder && host.encoder.state === "configured") {
			host.peakEncodeQueueSize = Math.max(
				host.peakEncodeQueueSize,
				host.encoder.encodeQueueSize,
				host.encodeQueue,
			);
			host.encodeQueue++;
			host.encoder.encode(exportFrame, {
				keyFrame: frameIndex % Math.max(host.keyFrameInterval, 1) === 0,
			});
			host.peakEncodeQueueSize = Math.max(
				host.peakEncodeQueueSize,
				host.encoder.encodeQueueSize,
				host.encodeQueue,
			);
		} else {
			console.warn(
				`[Frame ${frameIndex}] Encoder not ready! State: ${host.encoder?.state}`,
			);
		}
	} finally {
		exportFrame.close();
	}
}

function getCurrentEncodeBacklog(host: ExporterHost): number {
	return Math.max(host.encoder?.encodeQueueSize ?? 0, host.encodeQueue);
}
