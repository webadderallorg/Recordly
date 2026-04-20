import type { WebDemuxer } from "web-demuxer";
import type { VideoMuxer } from "../muxer";
import {
	AUDIO_BITRATE,
	DECODE_BACKPRESSURE_LIMIT,
	ENCODE_BACKPRESSURE_LIMIT,
	MP4_AUDIO_CODEC,
	cloneAudioDataWithTimestamp,
	cloneEncodedAudioChunkWithTimestamp,
	computeTrimOffset,
	isInTrimRegion,
	type TrimLikeRegion,
} from "./shared";

/** Check whether the codec can be passed through without re-encoding. */
function isPassthroughAudioCodec(codec: string | undefined): boolean {
	if (!codec) return false;
	const normalizedCodec = codec.toLowerCase();
	return (
		normalizedCodec === MP4_AUDIO_CODEC ||
		normalizedCodec === "aac" ||
		normalizedCodec.startsWith("mp4a.40.2")
	);
}

/** Copy encoded audio chunks directly to the muxer without re-encoding. */
export async function passthroughAudioStream(
	audioStream: ReadableStream<EncodedAudioChunk>,
	audioConfig: AudioDecoderConfig,
	muxer: VideoMuxer,
	cancelled: { current: boolean },
): Promise<boolean> {
	if (!isPassthroughAudioCodec(audioConfig.codec)) {
		return false;
	}

	let reader: ReadableStreamDefaultReader<EncodedAudioChunk> | null = null;
	let wroteAudio = false;
	let passthroughTimestampOffsetUs: number | null = null;

	try {
		reader = audioStream.getReader();
		while (!cancelled.current) {
			const { done, value: chunk } = await reader.read();
			if (done || !chunk) break;

			if (passthroughTimestampOffsetUs === null) {
				passthroughTimestampOffsetUs = chunk.timestamp;
			}

			const normalizedTimestamp = Math.max(
				0,
				chunk.timestamp - passthroughTimestampOffsetUs,
			);

			const outputChunk =
				passthroughTimestampOffsetUs === 0
					? chunk
					: cloneEncodedAudioChunkWithTimestamp(chunk, normalizedTimestamp);

			await muxer.addAudioChunk(
				outputChunk,
				wroteAudio
					? undefined
					: { decoderConfig: audioConfig },
			);
			wroteAudio = true;
		}
	} finally {
		if (reader) {
			try {
				await reader.cancel();
			} catch {
				// reader already closed
			}
		}
	}

	return wroteAudio;
}

/** Decode-then-re-encode audio stream with optional timestamp transforms. */
export async function transcodeAudioStream(
	audioStream: ReadableStream<EncodedAudioChunk>,
	audioConfig: AudioDecoderConfig,
	muxer: VideoMuxer,
	cancelled: { current: boolean },
	options: {
		observeChunkTimestampUs?: (timestampUs: number) => void;
		shouldSkipChunk?: (timestampMs: number) => boolean;
		transformAudioData?: (data: AudioData) => AudioData | null;
	} = {},
): Promise<void> {
	const pendingFrames: AudioData[] = [];
	let decodeError: Error | null = null;
	let encodeError: Error | null = null;
	let muxError: Error | null = null;
	let pendingMuxing = Promise.resolve();

	const failIfNeeded = () => {
		if (decodeError) throw decodeError;
		if (encodeError) throw encodeError;
		if (muxError) throw muxError;
	};

	const pumpEncodedFrames = () => {
		while (!cancelled.current && pendingFrames.length > 0) {
			if (encodeError || muxError) break;
			if (encoder.encodeQueueSize >= ENCODE_BACKPRESSURE_LIMIT) break;

			const frame = pendingFrames.shift();
			if (!frame) break;

			encoder.encode(frame);
			frame.close();
		}
	};

	const cleanupPendingFrames = () => {
		for (const frame of pendingFrames) {
			frame.close();
		}
		pendingFrames.length = 0;
	};

	const sampleRate = audioConfig.sampleRate || 48_000;
	const channels = audioConfig.numberOfChannels || 2;
	const encodeConfig: AudioEncoderConfig = {
		codec: MP4_AUDIO_CODEC,
		sampleRate,
		numberOfChannels: channels,
		bitrate: AUDIO_BITRATE,
	};

	const encodeSupport = await AudioEncoder.isConfigSupported(encodeConfig);
	if (!encodeSupport.supported) {
		console.warn("[AudioProcessor] AAC encoding not supported, skipping audio");
		return;
	}

	const encoder = new AudioEncoder({
		output: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => {
			pendingMuxing = pendingMuxing
				.then(async () => {
					if (cancelled.current) return;
					await muxer.addAudioChunk(chunk, meta);
				})
				.catch((error) => {
					muxError = error instanceof Error ? error : new Error(String(error));
				});
		},
		error: (error: DOMException) => {
			encodeError = new Error(`[AudioProcessor] Encode error: ${error.message}`);
		},
	});

	encoder.configure(encodeConfig);

	const decoder = new AudioDecoder({
		output: (data: AudioData) => {
			if (cancelled.current || encodeError || muxError) {
				data.close();
				return;
			}

			const transformed = options.transformAudioData
				? options.transformAudioData(data)
				: data;

			if (transformed !== data) {
				data.close();
			}

			if (!transformed) return;

			pendingFrames.push(transformed);
		},
		error: (error: DOMException) => {
			decodeError = new Error(`[AudioProcessor] Decode error: ${error.message}`);
		},
	});
	decoder.configure(audioConfig);

	let reader: ReadableStreamDefaultReader<EncodedAudioChunk> | null = null;

	try {
		reader = audioStream.getReader();
		while (!cancelled.current) {
			failIfNeeded();

			const { done, value: chunk } = await reader.read();
			if (done || !chunk) break;

			options.observeChunkTimestampUs?.(chunk.timestamp);
			const timestampMs = chunk.timestamp / 1000;
			if (options.shouldSkipChunk?.(timestampMs)) continue;

			decoder.decode(chunk);
			pumpEncodedFrames();

			while (
				!cancelled.current &&
				(decoder.decodeQueueSize > DECODE_BACKPRESSURE_LIMIT ||
					pendingFrames.length > DECODE_BACKPRESSURE_LIMIT ||
					encoder.encodeQueueSize >= ENCODE_BACKPRESSURE_LIMIT)
			) {
				failIfNeeded();
				pumpEncodedFrames();
				await new Promise((resolve) => setTimeout(resolve, 1));
			}
		}

		if (decoder.state === "configured") {
			await decoder.flush();
		}

		while (!cancelled.current && (pendingFrames.length > 0 || encoder.encodeQueueSize > 0)) {
			failIfNeeded();
			pumpEncodedFrames();
			if (pendingFrames.length > 0 || encoder.encodeQueueSize > 0) {
				await new Promise((resolve) => setTimeout(resolve, 1));
			}
		}

		failIfNeeded();

		if (encoder.state === "configured") {
			await encoder.flush();
		}

		await pendingMuxing;
		failIfNeeded();
	} finally {
		if (reader) {
			try {
				await reader.cancel();
			} catch {
				// reader already closed
			}
		}

		cleanupPendingFrames();

		if (decoder.state === "configured") {
			decoder.close();
		}

		if (encoder.state === "configured") {
			encoder.close();
		}
	}

	if (cancelled.current) return;
}

/** Process trim-only audio: passthrough attempt then transcode with trim remap. */
export async function processTrimOnlyAudio(
	demuxer: WebDemuxer,
	muxer: VideoMuxer,
	sortedTrims: TrimLikeRegion[],
	cancelled: { current: boolean },
	readEndSec?: number,
): Promise<void> {
	let audioConfig: AudioDecoderConfig;
	try {
		audioConfig = (await demuxer.getDecoderConfig("audio")) as AudioDecoderConfig;
	} catch {
		console.warn("[AudioProcessor] No audio track found, skipping");
		return;
	}

	const codecCheck = await AudioDecoder.isConfigSupported(audioConfig);
	if (!codecCheck.supported) {
		console.warn("[AudioProcessor] Audio codec not supported:", audioConfig.codec);
		return;
	}

	const audioStream =
		typeof readEndSec === "number"
			? demuxer.read("audio", 0, readEndSec)
			: demuxer.read("audio");

	let sourceTimestampOffsetUs: number | null = null;

	await transcodeAudioStream(
		audioStream as ReadableStream<EncodedAudioChunk>,
		audioConfig,
		muxer,
		cancelled,
		{
			observeChunkTimestampUs: (timestampUs) => {
				if (sourceTimestampOffsetUs === null) {
					sourceTimestampOffsetUs = timestampUs;
				}
			},
			shouldSkipChunk: (timestampMs) => isInTrimRegion(timestampMs, sortedTrims),
			transformAudioData: (data) => {
				const timestampMs = data.timestamp / 1000;
				const trimOffsetMs = computeTrimOffset(timestampMs, sortedTrims);
				const adjustedTimestampUs =
					data.timestamp - (sourceTimestampOffsetUs ?? 0) - trimOffsetMs * 1000;
				return cloneAudioDataWithTimestamp(data, Math.max(0, adjustedTimestampUs));
			},
		},
	);
}
