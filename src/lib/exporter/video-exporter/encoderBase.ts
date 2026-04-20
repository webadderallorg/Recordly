import { FrameRenderer } from "../frameRenderer";
import { VideoMuxer } from "../muxer";
import { VideoExporterProgressBase } from "./progressBase";
import { DEFAULT_MAX_ENCODE_QUEUE } from "./shared";

export abstract class VideoExporterEncoderBase extends VideoExporterProgressBase {
	protected renderer: FrameRenderer | null = null;
	protected encoder: VideoEncoder | null = null;
	protected muxer: VideoMuxer | null = null;
	protected cancelled = false;
	protected encodeQueue = 0;
	protected videoDescription: Uint8Array | undefined;
	protected videoColorSpace: VideoColorSpaceInit | undefined;
	protected pendingMuxing: Promise<void> = Promise.resolve();
	protected chunkCount = 0;
	protected encoderError: Error | null = null;
	protected nativeExportSessionId: string | null = null;
	protected nativeH264Encoder: VideoEncoder | null = null;
	protected nativePendingWrite: Promise<void> = Promise.resolve();
	protected nativeWritePromises = new Set<Promise<void>>();
	protected nativeWriteError: Error | null = null;
	protected maxNativeWriteInFlight = 1;
	protected nativeEncoderError: Error | null = null;

	protected shouldUseExperimentalNativeExport(): boolean {
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

	protected async tryStartNativeVideoExport(): Promise<boolean> {
		if (!this.shouldUseExperimentalNativeExport()) {
			return false;
		}

		if (this.config.width % 2 !== 0 || this.config.height % 2 !== 0) {
			console.warn(
				`[VideoExporter] Native export requires even output dimensions, falling back to WebCodecs (${this.config.width}x${this.config.height})`,
			);
			return false;
		}

		const encoderConfig: VideoEncoderConfig = {
			codec: "avc1.640034",
			width: this.config.width,
			height: this.config.height,
			bitrate: this.config.bitrate,
			framerate: this.config.frameRate,
			hardwareAcceleration: "prefer-hardware",
			avc: { format: "annexb" },
		};

		try {
			const support = await VideoEncoder.isConfigSupported(encoderConfig);
			if (!support.supported) {
				console.warn(
					`[VideoExporter] Native H.264 Annex B encoding is unsupported at ${this.config.width}x${this.config.height}`,
				);
				return false;
			}
		} catch (error) {
			console.warn("[VideoExporter] Native encoder support check failed:", error);
			return false;
		}

		const result = await window.electronAPI.nativeVideoExportStart({
			width: this.config.width,
			height: this.config.height,
			frameRate: this.config.frameRate,
			bitrate: this.config.bitrate,
			encodingMode: this.config.encodingMode ?? "balanced",
			inputMode: "h264-stream",
		});

		if (!result.success || !result.sessionId) {
			console.warn("[VideoExporter] Native export unavailable", result.error);
			return false;
		}

		this.nativeExportSessionId = result.sessionId;
		this.nativePendingWrite = Promise.resolve();
		this.nativeWritePromises = new Set();
		this.nativeWriteError = null;
		this.maxNativeWriteInFlight = Math.max(
			1,
			Math.floor(this.config.maxInFlightNativeWrites ?? 1),
		);

		const sessionId = result.sessionId;
		const encoder = new VideoEncoder({
			output: (chunk) => {
				if (this.cancelled || !this.nativeExportSessionId) return;
				const buffer = new ArrayBuffer(chunk.byteLength);
				chunk.copyTo(buffer);
				const writePromise = this.nativePendingWrite
					.then(async () => {
						const writeResult = await window.electronAPI.nativeVideoExportWriteFrame(
							sessionId,
							new Uint8Array(buffer),
						);
						if (!writeResult.success && !this.cancelled) {
							throw new Error(
								writeResult.error || "Failed to write H.264 chunk to native encoder",
							);
						}
					})
					.catch((error) => {
						if (!this.cancelled && !this.nativeEncoderError) {
							this.nativeEncoderError =
								error instanceof Error ? error : new Error(String(error));
						}
						if (!this.cancelled && !this.nativeWriteError) {
							this.nativeWriteError =
								error instanceof Error ? error : new Error(String(error));
						}
					});
				this.nativePendingWrite = writePromise;
				this.trackNativeWritePromise(writePromise);
			},
			error: (error) => {
				this.nativeEncoderError = error;
			},
		});

		try {
			encoder.configure(encoderConfig);
		} catch (error) {
			this.nativeEncoderError = error instanceof Error ? error : new Error(String(error));
			try {
				encoder.close();
			} catch (closeError) {
				console.debug(
					"[VideoExporter] Ignoring error closing native encoder after startup failure:",
					closeError,
				);
			}
			this.nativeExportSessionId = null;
			await window.electronAPI.nativeVideoExportCancel(sessionId);
			return false;
		}

		this.nativeH264Encoder = encoder;
		return true;
	}

	protected async encodeRenderedFrameNative(
		timestamp: number,
		frameDuration: number,
		frameIndex: number,
	): Promise<void> {
		if (!this.nativeH264Encoder || !this.nativeExportSessionId) {
			if (this.cancelled) return;
			throw new Error("Native export session is not active");
		}

		if (this.nativeEncoderError) throw this.nativeEncoderError;
		if (this.nativeWriteError) throw this.nativeWriteError;

		while (this.nativeWritePromises.size >= this.maxNativeWriteInFlight && !this.cancelled) {
			await this.awaitOldestNativeWrite();
			if (this.nativeEncoderError) throw this.nativeEncoderError;
			if (this.nativeWriteError) throw this.nativeWriteError;
		}

		while (
			this.nativeH264Encoder.encodeQueueSize >=
				Math.max(1, Math.floor(this.config.maxEncodeQueue ?? DEFAULT_MAX_ENCODE_QUEUE))
		) {
			await new Promise<void>((resolve) => setTimeout(resolve, 2));
			if (this.cancelled) return;
			if (this.nativeEncoderError) throw this.nativeEncoderError;
			if (this.nativeWriteError) throw this.nativeWriteError;
		}

		const canvas = this.renderer!.getCanvas();
		// @ts-expect-error - colorSpace not in TypeScript definitions but works at runtime
		const frame = new VideoFrame(canvas, {
			timestamp,
			duration: frameDuration,
			colorSpace: {
				primaries: "bt709",
				transfer: "iec61966-2-1",
				matrix: "rgb",
				fullRange: true,
			},
		});
		this.nativeH264Encoder.encode(frame, { keyFrame: frameIndex % 300 === 0 });
		frame.close();
	}

	protected async encodeRenderedFrame(
		timestamp: number,
		frameDuration: number,
		frameIndex: number,
	) {
		const canvas = this.renderer!.getCanvas();

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
			this.encoder &&
			this.encoder.encodeQueueSize >=
				Math.max(1, Math.floor(this.config.maxEncodeQueue ?? DEFAULT_MAX_ENCODE_QUEUE)) &&
			!this.cancelled
		) {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}

		if (this.encoder && this.encoder.state === "configured") {
			this.encodeQueue++;
			this.encoder.encode(exportFrame, { keyFrame: frameIndex % 150 === 0 });
		} else {
			console.warn(`[Frame ${frameIndex}] Encoder not ready! State: ${this.encoder?.state}`);
		}

		exportFrame.close();
	}

	protected trackNativeWritePromise(writePromise: Promise<void>): void {
		this.nativeWritePromises.add(writePromise);

		void writePromise.finally(() => {
			this.nativeWritePromises.delete(writePromise);
		});
	}

	protected async awaitOldestNativeWrite(): Promise<void> {
		const oldestWritePromise = this.nativeWritePromises.values().next().value;
		if (!oldestWritePromise) {
			return;
		}

		await this.awaitWithFinalizationTimeout(oldestWritePromise, "native frame write");

		if (this.nativeWriteError) {
			throw this.nativeWriteError;
		}
	}

	protected async awaitPendingNativeWrites(): Promise<void> {
		while (this.nativeWritePromises.size > 0) {
			await this.awaitOldestNativeWrite();
		}

		if (this.nativeWriteError) {
			throw this.nativeWriteError;
		}
	}

	protected async initializeEncoder(): Promise<void> {
		this.encodeQueue = 0;
		this.pendingMuxing = Promise.resolve();
		this.chunkCount = 0;
		let videoDescription: Uint8Array | undefined;
		const codecFallbackList = this.config.codec
			? [this.config.codec]
			: ["avc1.640033", "avc1.4d4033", "avc1.420033", "avc1.4d401f", "avc1.42001f"];
		let resolvedCodec: string | null = null;

		this.encoder = new VideoEncoder({
			output: (chunk, meta) => {
				if (meta?.decoderConfig?.description && !videoDescription) {
					const description = meta.decoderConfig.description;
					videoDescription = ArrayBuffer.isView(description)
						? new Uint8Array(
								description.buffer,
								description.byteOffset,
								description.byteLength,
							)
						: new Uint8Array(description);
					this.videoDescription = videoDescription;
				}
				if (meta?.decoderConfig?.colorSpace && !this.videoColorSpace) {
					this.videoColorSpace = meta.decoderConfig.colorSpace;
				}

				const isFirstChunk = this.chunkCount === 0;
				this.chunkCount++;

				this.pendingMuxing = this.pendingMuxing.then(async () => {
					try {
						if (isFirstChunk && this.videoDescription) {
							const colorSpace = this.videoColorSpace || {
								primaries: "bt709",
								transfer: "iec61966-2-1",
								matrix: "rgb",
								fullRange: true,
							};

							const metadata: EncodedVideoChunkMetadata = {
								decoderConfig: {
									codec: resolvedCodec ?? (this.config.codec || "avc1.640033"),
									codedWidth: this.config.width,
									codedHeight: this.config.height,
									description: this.videoDescription,
									colorSpace,
								},
							};

							await this.muxer!.addVideoChunk(chunk, metadata);
						} else {
							await this.muxer!.addVideoChunk(chunk, meta);
						}
					} catch (error) {
						console.error("Muxing error:", error);
						const muxingError = error instanceof Error ? error : new Error(String(error));
						if (!this.encoderError) {
							this.encoderError = muxingError;
						}
						this.cancelled = true;
					}
				});
				this.encodeQueue--;
			},
			error: (error) => {
				console.error(
					`[VideoExporter] Encoder error (codec: ${resolvedCodec}, ${this.config.width}x${this.config.height}):`,
					error,
				);
				this.encoderError = error instanceof Error ? error : new Error(String(error));
				this.cancelled = true;
			},
		});

		const baseConfig: Omit<VideoEncoderConfig, "codec" | "hardwareAcceleration"> = {
			width: this.config.width,
			height: this.config.height,
			bitrate: this.config.bitrate,
			framerate: this.config.frameRate,
			latencyMode: "quality",
			bitrateMode: "variable",
		};

		for (const candidateCodec of codecFallbackList) {
			const hardwareConfig: VideoEncoderConfig = {
				...baseConfig,
				codec: candidateCodec,
				hardwareAcceleration: "prefer-hardware",
			};
			const hardwareSupport = await VideoEncoder.isConfigSupported(hardwareConfig);
			if (hardwareSupport.supported) {
				resolvedCodec = candidateCodec;
				console.log(
					`[VideoExporter] Using hardware acceleration with codec ${candidateCodec}`,
				);
				this.encoder.configure(hardwareConfig);
				return;
			}

			const softwareConfig: VideoEncoderConfig = {
				...baseConfig,
				codec: candidateCodec,
				hardwareAcceleration: "prefer-software",
			};
			const softwareSupport = await VideoEncoder.isConfigSupported(softwareConfig);
			if (softwareSupport.supported) {
				resolvedCodec = candidateCodec;
				console.log(`[VideoExporter] Using software encoding with codec ${candidateCodec}`);
				this.encoder.configure(softwareConfig);
				return;
			}

			console.warn(
				`[VideoExporter] Codec ${candidateCodec} not supported (${this.config.width}x${this.config.height}), trying next...`,
			);
		}

		throw new Error(
			`Video encoding not supported on this system. Tried codecs: ${codecFallbackList.join(", ")} at ${this.config.width}x${this.config.height}. Your browser or hardware may not support H.264 encoding at this resolution. Try exporting at a lower quality setting.`,
		);
	}
}