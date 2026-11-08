import type { LegacyVideoExporterContext } from "./legacyVideoExporterContext";
import { DEFAULT_MAX_ENCODE_QUEUE } from "./legacyVideoExporterContext";
import { MP4_CODEC_FALLBACK_LIST } from "./mp4Support";
import { ENCODED_H264_COLOR_SPACE_FALLBACK, EXPORT_CANVAS_COLOR_SPACE } from "./videoColorSpace";

export async function encodeRenderedFrame(
	context: Pick<
		LegacyVideoExporterContext,
		"renderer" | "encoder" | "config" | "cancelled" | "encodeQueue"
	>,
	timestamp: number,
	frameDuration: number,
	frameIndex: number,
): Promise<void> {
	const canvas = context.renderer!.getCanvas();

	// @ts-expect-error - colorSpace not in TypeScript definitions but works at runtime
	const exportFrame = new VideoFrame(canvas, {
		timestamp,
		duration: frameDuration,
		colorSpace: EXPORT_CANVAS_COLOR_SPACE,
	});

	while (
		context.encoder &&
		context.encoder.encodeQueueSize >=
			Math.max(1, Math.floor(context.config.maxEncodeQueue ?? DEFAULT_MAX_ENCODE_QUEUE)) &&
		!context.cancelled
	) {
		await new Promise((resolve) => setTimeout(resolve, 5));
	}

	if (context.encoder && context.encoder.state === "configured") {
		context.encodeQueue++;
		context.encoder.encode(exportFrame, { keyFrame: frameIndex % 150 === 0 });
	} else {
		console.warn(`[Frame ${frameIndex}] Encoder not ready! State: ${context.encoder?.state}`);
	}

	exportFrame.close();
}

export async function initializeEncoder(
	context: Pick<
		LegacyVideoExporterContext,
		| "encodeQueue"
		| "pendingMuxing"
		| "chunkCount"
		| "config"
		| "encoder"
		| "videoDescription"
		| "videoColorSpace"
		| "muxer"
		| "encoderError"
		| "cancelled"
	>,
): Promise<void> {
	context.encodeQueue = 0;
	context.pendingMuxing = Promise.resolve();
	context.chunkCount = 0;
	let videoDescription: Uint8Array | undefined;

	// The full-size probe may require another H.264 level/profile. Keep its
	// selected codec first and retain the configured codec and compatibility paths.
	const CODEC_FALLBACK_LIST = [
		...new Set(
			[
				context.config.preferredEncoderPath?.codec,
				context.config.codec,
				...MP4_CODEC_FALLBACK_LIST,
			].filter((codec): codec is string => Boolean(codec)),
		),
	];

	let resolvedCodec: string | null = null;

	context.encoder = new VideoEncoder({
		output: (chunk, meta) => {
			// Capture decoder config metadata from encoder output
			if (meta?.decoderConfig?.description && !videoDescription) {
				const desc = meta.decoderConfig.description;
				videoDescription = ArrayBuffer.isView(desc)
					? new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength)
					: new Uint8Array(desc);
				context.videoDescription = videoDescription;
			}
			// Capture colorSpace from encoder metadata if provided
			if (meta?.decoderConfig?.colorSpace && !context.videoColorSpace) {
				context.videoColorSpace = meta.decoderConfig.colorSpace;
			}

			// Stream chunks to muxer in order without retaining an ever-growing promise array
			const isFirstChunk = context.chunkCount === 0;
			context.chunkCount++;

			context.pendingMuxing = context.pendingMuxing.then(async () => {
				try {
					if (isFirstChunk && context.videoDescription) {
						// Add decoder config for the first chunk
						const colorSpace =
							context.videoColorSpace || ENCODED_H264_COLOR_SPACE_FALLBACK;

						const metadata: EncodedVideoChunkMetadata = {
							decoderConfig: {
								codec: resolvedCodec ?? (context.config.codec || "avc1.640033"),
								codedWidth: context.config.width,
								codedHeight: context.config.height,
								description: context.videoDescription,
								colorSpace,
							},
						};

						await context.muxer!.addVideoChunk(chunk, metadata);
					} else {
						await context.muxer!.addVideoChunk(chunk, meta);
					}
				} catch (error) {
					console.error("Muxing error:", error);
					const muxingError = error instanceof Error ? error : new Error(String(error));
					if (!context.encoderError) {
						context.encoderError = muxingError;
					}
					context.cancelled = true;
				}
			});
			context.encodeQueue--;
		},
		error: (error) => {
			console.error(
				`[VideoExporter] Encoder error (codec: ${resolvedCodec}, ${context.config.width}x${context.config.height}):`,
				error,
			);
			context.encoderError = error instanceof Error ? error : new Error(String(error));
			context.cancelled = true;
		},
	});

	const baseConfig: Omit<VideoEncoderConfig, "codec" | "hardwareAcceleration"> = {
		width: context.config.width,
		height: context.config.height,
		bitrate: context.config.bitrate,
		framerate: context.config.frameRate,
		latencyMode: "quality",
		bitrateMode: "variable",
	};
	const supported = async (config: VideoEncoderConfig) => {
		try {
			return (await VideoEncoder.isConfigSupported(config)).supported;
		} catch {
			// Unsupported profiles can throw rather than return supported:false.
			return false;
		}
	};

	for (const candidateCodec of CODEC_FALLBACK_LIST) {
		const hwConfig: VideoEncoderConfig = {
			...baseConfig,
			codec: candidateCodec,
			hardwareAcceleration: "prefer-hardware",
		};
		if (await supported(hwConfig)) {
			resolvedCodec = candidateCodec;
			console.log(`[VideoExporter] Using hardware acceleration with codec ${candidateCodec}`);
			context.encoder.configure(hwConfig);
			return;
		}

		const swConfig: VideoEncoderConfig = {
			...baseConfig,
			codec: candidateCodec,
			hardwareAcceleration: "prefer-software",
		};
		if (await supported(swConfig)) {
			resolvedCodec = candidateCodec;
			console.log(`[VideoExporter] Using software encoding with codec ${candidateCodec}`);
			context.encoder.configure(swConfig);
			return;
		}

		console.warn(
			`[VideoExporter] Codec ${candidateCodec} not supported (${context.config.width}x${context.config.height}), trying next...`,
		);
	}

	throw new Error(
		`Video encoding not supported on this system. ` +
			`Tried codecs: ${CODEC_FALLBACK_LIST.join(", ")} at ${context.config.width}x${context.config.height}. ` +
			`Your browser or hardware may not support H.264 encoding at this resolution. ` +
			`Try exporting at a lower quality setting.`,
	);
}
