import type { AudioRegion, SpeedRegion } from "@/components/video-editor/types";
import { estimateCompanionAudioStartDelaySeconds } from "@/lib/mediaTiming";
import type { VideoMuxer } from "../muxer";
import { decodeAudioFromUrl, getMediaDurationSec } from "./decoding";
import {
	audioBufferToPcmParts,
	createWavHeader,
	feedBufferToEncoder,
	scheduleBufferThroughTimeline,
	scheduleRegionForChunk,
} from "./renderHelpers";
import {
	AUDIO_BITRATE,
	MP4_AUDIO_CODEC,
	OFFLINE_AUDIO_SAMPLE_RATE,
	OFFLINE_CHUNK_DURATION_SEC,
	buildTimelineSlices,
	sourceTimeToOutputTime,
	type PreparedOfflineRender,
	type TrimLikeRegion,
} from "./shared";

export async function prepareOfflineRender(
	videoUrl: string,
	trimRegions: TrimLikeRegion[],
	speedRegions: SpeedRegion[],
	audioRegions: AudioRegion[],
	sourceAudioFallbackPaths: string[],
	cancelled: { current: boolean },
	onProgress?: (progress: number) => void,
): Promise<PreparedOfflineRender> {
	if (cancelled.current) throw new Error("Export cancelled");
	onProgress?.(0);

	const hasExternalSources = sourceAudioFallbackPaths.length > 0;

	const mainBuffer = !hasExternalSources
		? await decodeAudioFromUrl(videoUrl, cancelled)
		: null;
	if (cancelled.current) throw new Error("Export cancelled");

	const companionEntries: Array<{ buffer: AudioBuffer; startDelaySec: number }> = [];
	for (const audioPath of sourceAudioFallbackPaths) {
		if (cancelled.current) throw new Error("Export cancelled");
		const buffer = await decodeAudioFromUrl(audioPath, cancelled);
		if (!buffer) continue;

		const refDuration =
			mainBuffer?.duration ?? (await getMediaDurationSec(audioPath));
		companionEntries.push({
			buffer,
			startDelaySec: estimateCompanionAudioStartDelaySeconds(
				refDuration,
				buffer.duration,
			),
		});
	}
	if (cancelled.current) throw new Error("Export cancelled");

	const regionEntries: Array<{ buffer: AudioBuffer; region: AudioRegion }> = [];
	for (const region of audioRegions) {
		if (cancelled.current) throw new Error("Export cancelled");
		const buffer = await decodeAudioFromUrl(region.audioPath, cancelled);
		if (buffer) regionEntries.push({ buffer, region });
	}

	onProgress?.(0.2);

	const primaryBuffer = mainBuffer ?? companionEntries[0]?.buffer ?? null;
	if (!primaryBuffer && regionEntries.length === 0) {
		throw new Error("No decodable audio sources found");
	}

	let sourceDurationSec: number;
	if (mainBuffer) {
		sourceDurationSec = mainBuffer.duration;
	} else if (hasExternalSources || regionEntries.length > 0) {
		sourceDurationSec = await getMediaDurationSec(videoUrl);
	} else {
		sourceDurationSec = primaryBuffer?.duration ?? 0;
	}
	const sourceDurationMs = sourceDurationSec * 1000;

	const slices = buildTimelineSlices(sourceDurationMs, trimRegions, speedRegions);

	let outputDurationMs = 0;
	for (const slice of slices) {
		outputDurationMs += (slice.sourceEndMs - slice.sourceStartMs) / slice.speed;
	}

	for (const { region } of regionEntries) {
		const regionEndOutput = sourceTimeToOutputTime(region.endMs, slices);
		outputDurationMs = Math.max(outputDurationMs, regionEndOutput);
	}

	const numChannels = Math.min(primaryBuffer?.numberOfChannels ?? 2, 2);

	return {
		mainBuffer,
		companionEntries,
		regionEntries,
		slices,
		outputDurationMs,
		numChannels,
	};
}

// ----- Chunked rendering loop -----

async function renderChunked(
	prepared: PreparedOfflineRender,
	totalOutputSec: number,
	cancelled: { current: boolean },
	onProgress: ((progress: number) => void) | undefined,
	onChunk: (
		rendered: AudioBuffer,
		outputOffsetSec: number,
		chunkIndex: number,
	) => Promise<void>,
): Promise<void> {
	const { slices, numChannels } = prepared;
	let outputOffsetSec = 0;
	const chunkCount = Math.ceil(totalOutputSec / OFFLINE_CHUNK_DURATION_SEC);

	for (let i = 0; i < chunkCount && !cancelled.current; i++) {
		const chunkSec = Math.min(
			OFFLINE_CHUNK_DURATION_SEC,
			totalOutputSec - outputOffsetSec,
		);
		const chunkFrames = Math.ceil(chunkSec * OFFLINE_AUDIO_SAMPLE_RATE);

		const offlineCtx = new OfflineAudioContext(
			numChannels,
			chunkFrames,
			OFFLINE_AUDIO_SAMPLE_RATE,
		);

		if (prepared.mainBuffer) {
			scheduleBufferThroughTimeline(
				offlineCtx,
				prepared.mainBuffer,
				slices,
				0,
				outputOffsetSec,
				chunkSec,
			);
		}

		for (const entry of prepared.companionEntries) {
			scheduleBufferThroughTimeline(
				offlineCtx,
				entry.buffer,
				slices,
				entry.startDelaySec,
				outputOffsetSec,
				chunkSec,
			);
		}

		for (const { buffer, region } of prepared.regionEntries) {
			scheduleRegionForChunk(
				offlineCtx,
				buffer,
				region,
				slices,
				outputOffsetSec,
				chunkSec,
			);
		}

		const rendered = await offlineCtx.startRendering();
		if (cancelled.current) break;

		await onChunk(rendered, outputOffsetSec, i);

		outputOffsetSec += chunkSec;
		onProgress?.(0.3 + (outputOffsetSec / totalOutputSec) * 0.7);
	}
}

// ----- Render + encode to muxer -----

export async function renderAndEncodeChunked(
	prepared: PreparedOfflineRender,
	muxer: VideoMuxer,
	cancelled: { current: boolean },
	onProgress?: (progress: number) => void,
): Promise<void> {
	const { numChannels } = prepared;
	const totalOutputSec = Math.max(prepared.outputDurationMs / 1000, 0.01);

	let encodeError: Error | null = null;
	let muxError: Error | null = null;
	let pendingMuxing = Promise.resolve();
	let wroteFirstChunk = false;

	const encodeConfig: AudioEncoderConfig = {
		codec: MP4_AUDIO_CODEC,
		sampleRate: OFFLINE_AUDIO_SAMPLE_RATE,
		numberOfChannels: numChannels,
		bitrate: AUDIO_BITRATE,
	};

	const supported = await AudioEncoder.isConfigSupported(encodeConfig);
	if (!supported.supported) {
		console.warn("[AudioProcessor] AAC encoding not supported for offline audio");
		return;
	}

	const encoder = new AudioEncoder({
		output: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => {
			pendingMuxing = pendingMuxing
				.then(async () => {
					if (cancelled.current) return;
					await muxer.addAudioChunk(
						chunk,
						!wroteFirstChunk ? meta : undefined,
					);
					wroteFirstChunk = true;
				})
				.catch((error) => {
					muxError = error instanceof Error ? error : new Error(String(error));
				});
		},
		error: (error: DOMException) => {
			encodeError = new Error(`Audio encode error: ${error.message}`);
		},
	});
	encoder.configure(encodeConfig);

	try {
		await renderChunked(
			prepared,
			totalOutputSec,
			cancelled,
			onProgress,
			async (rendered, outputOffsetSec) => {
				if (encodeError) throw encodeError;
				if (muxError) throw muxError;
				await feedBufferToEncoder(encoder, rendered, outputOffsetSec, cancelled);
			},
		);

		if (encodeError) throw encodeError;
		if (muxError) throw muxError;

		if (encoder.state === "configured") {
			await encoder.flush();
		}

		await pendingMuxing;

		if (encodeError) throw encodeError;
		if (muxError) throw muxError;
	} finally {
		if (encoder.state === "configured") {
			encoder.close();
		}
	}
}

// ----- Render to WAV blob -----

export async function renderToWavBlobChunked(
	prepared: PreparedOfflineRender,
	cancelled: { current: boolean },
): Promise<Blob> {
	const totalOutputSec = Math.max(prepared.outputDurationMs / 1000, 0.01);
	const totalFrames = Math.ceil(totalOutputSec * OFFLINE_AUDIO_SAMPLE_RATE);
	const numChannels = prepared.numChannels;

	const header = createWavHeader(OFFLINE_AUDIO_SAMPLE_RATE, numChannels, totalFrames);
	const pcmParts: ArrayBuffer[] = [header];

	await renderChunked(
		prepared,
		totalOutputSec,
		cancelled,
		undefined,
		async (rendered) => {
			pcmParts.push(...audioBufferToPcmParts(rendered));
		},
	);

	return new Blob(pcmParts, { type: "audio/wav" });
}

