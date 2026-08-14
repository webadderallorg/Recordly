import {
	BufferTarget,
	EncodedAudioPacketSource,
	EncodedPacket,
	EncodedVideoPacketSource,
	type Target as MediabunnyTarget,
	Mp4OutputFormat,
	Output,
	StreamTarget,
} from "mediabunny";
import { formatLogTs } from "@/lib/log";
import type { ExportConfig } from "./types";

/**
 * Chunk boundary used by both the mediabunny StreamTarget and the IPC writer.
 * 16 MiB is well below Electron's IPC size limits and keeps per-chunk overhead
 * low — large enough that a 35-minute 1080p export only produces a few hundred
 * writes across the renderer/main boundary.
 */
const EXPORT_STREAM_CHUNK_BYTES = 16 * 1024 * 1024;

type IpcStreamSink = {
	readonly streamId: string;
	readonly tempPath: string;
};

async function openIpcExportStream(): Promise<IpcStreamSink> {
	if (typeof window === "undefined" || !window.electronAPI?.openExportStream) {
		throw new Error("openExportStream IPC is unavailable in this environment");
	}
	const result = await window.electronAPI.openExportStream({ extension: "mp4" });
	if (!result.success || !result.streamId || !result.tempPath) {
		throw new Error(result.error || "Failed to open export stream");
	}
	return { streamId: result.streamId, tempPath: result.tempPath };
}

async function writeIpcExportStream(
	streamId: string,
	position: number,
	chunk: Uint8Array,
): Promise<void> {
	// Mediabunny owns the underlying buffer for the lifetime of the call, so we
	// copy the bytes before crossing the IPC boundary — ipcRenderer.invoke uses
	// a structured clone under the hood and the original buffer can be reused
	// by the muxer immediately after await returns.
	const copy = new Uint8Array(chunk.byteLength);
	copy.set(chunk);
	const result = await window.electronAPI!.writeExportStreamChunk(streamId, position, copy);
	if (!result.success) {
		throw new Error(result.error || "Failed to write export chunk");
	}
}

async function closeIpcExportStream(
	streamId: string,
	options?: { abort?: boolean },
): Promise<{ tempPath: string; bytesWritten: number }> {
	const result = await window.electronAPI!.closeExportStream(streamId, options);
	if (!result.success || !result.tempPath) {
		throw new Error(result.error || "Failed to close export stream");
	}
	return { tempPath: result.tempPath, bytesWritten: result.bytesWritten ?? 0 };
}

export type MuxerTargetMode = "stream" | "buffer";

export type MuxerFinalizeResult =
	| { mode: "stream"; tempFilePath: string; bytesWritten: number }
	| { mode: "buffer"; blob: Blob };

function shouldUseStreamTarget(): boolean {
	return (
		typeof window !== "undefined" &&
		typeof window.electronAPI?.openExportStream === "function" &&
		typeof window.electronAPI?.writeExportStreamChunk === "function" &&
		typeof window.electronAPI?.closeExportStream === "function"
	);
}

export class VideoMuxer {
	private output: Output | null = null;
	private videoSource: EncodedVideoPacketSource | null = null;
	private audioSource: EncodedAudioPacketSource | null = null;
	private hasAudio: boolean;
	private target: MediabunnyTarget | null = null;
	private config: ExportConfig;
	private mode: MuxerTargetMode;
	private streamSink: IpcStreamSink | null = null;

	constructor(config: ExportConfig, hasAudio = false, mode?: MuxerTargetMode) {
		this.config = config;
		this.hasAudio = hasAudio;
		this.mode = mode ?? (shouldUseStreamTarget() ? "stream" : "buffer");
	}

	getTargetMode(): MuxerTargetMode {
		return this.mode;
	}

	async initialize(): Promise<void> {
		const startedAt = Date.now();
		if (this.mode === "stream") {
			const sink = await openIpcExportStream();
			this.streamSink = sink;
			const streamId = sink.streamId;
			const writableStream = new WritableStream<{
				type: "write";
				data: Uint8Array;
				position: number;
			}>({
				async write(chunk) {
					if (chunk.type !== "write") {
						return;
					}
					await writeIpcExportStream(streamId, chunk.position, chunk.data);
				},
			});
			this.target = new StreamTarget(writableStream, {
				chunked: true,
				chunkSize: EXPORT_STREAM_CHUNK_BYTES,
			});
		} else {
			this.target = new BufferTarget();
		}

		this.output = new Output({
			format: new Mp4OutputFormat({
				fastStart: false,
			}),
			target: this.target,
		});

		this.videoSource = new EncodedVideoPacketSource("avc");
		this.output.addVideoTrack(this.videoSource, {
			frameRate: this.config.frameRate,
		});

		if (this.hasAudio) {
			this.audioSource = new EncodedAudioPacketSource("aac");
			this.output.addAudioTrack(this.audioSource);
		}

		await this.output.start();
		console.log(formatLogTs(), "[video-muxer] initialize", {
			elapsedMs: Date.now() - startedAt,
			mode: this.mode,
		});
	}

	async addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): Promise<void> {
		if (!this.videoSource) {
			throw new Error("Muxer not initialized");
		}

		const packet = EncodedPacket.fromEncodedChunk(chunk);
		await this.videoSource.add(packet, meta);
	}

	async addAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata): Promise<void> {
		if (!this.audioSource) {
			throw new Error("Audio not configured for this muxer");
		}

		const packet = EncodedPacket.fromEncodedChunk(chunk);
		await this.audioSource.add(packet, meta);
	}

	async finalize(): Promise<MuxerFinalizeResult> {
		if (!this.output || !this.target) {
			throw new Error("Muxer not initialized");
		}

		const startedAt = Date.now();

		await this.output.finalize();

		if (this.mode === "stream") {
			const sink = this.streamSink;
			if (!sink) {
				throw new Error("Stream target closed before finalization");
			}
			// Clear streamSink before awaiting close so a concurrent destroy()→
			// abortStream() short-circuits on `!this.streamSink` instead of racing
			// us for the same streamId.
			this.streamSink = null;
			const closeResult = await closeIpcExportStream(sink.streamId);
			const result: MuxerFinalizeResult = {
				mode: "stream",
				tempFilePath: closeResult.tempPath,
				bytesWritten: closeResult.bytesWritten,
			};
			console.log(formatLogTs(), "[video-muxer] finalize", {
				elapsedMs: Date.now() - startedAt,
				bytesWritten: closeResult.bytesWritten,
			});
			return result;
		}

		const buffer = (this.target as BufferTarget).buffer;
		if (!buffer) {
			throw new Error("Failed to finalize output");
		}
		console.log(formatLogTs(), "[video-muxer] finalize", {
			elapsedMs: Date.now() - startedAt,
			bytesWritten: buffer.byteLength,
		});
		return { mode: "buffer", blob: new Blob([buffer], { type: "video/mp4" }) };
	}

	async abortStream(): Promise<void> {
		if (this.mode !== "stream" || !this.streamSink) {
			return;
		}
		try {
			await closeIpcExportStream(this.streamSink.streamId, { abort: true });
		} catch {
			// Best-effort cleanup on cancel — the main process also reaps stale
			// streams on before-quit via cleanupAllExportStreams.
		} finally {
			this.streamSink = null;
		}
	}

	destroy(): void {
		this.output = null;
		this.videoSource = null;
		this.audioSource = null;
		this.target = null;
		if (this.streamSink) {
			void this.abortStream();
		}
	}
}
