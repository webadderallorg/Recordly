import { SOURCE_AUDIO_NORMALIZE_GAIN } from "@/components/video-editor/audio/audioTypes";
import type {
	AudioRegion,
	ClipRegion,
	SourceAudioTrackSettings,
	SpeedRegion,
} from "@/components/video-editor/types";
import {
	getClipSourceEndMs,
	getClipSourceStartMs,
	getTimelineDurationMs,
} from "@/components/video-editor/types";
import { buildResolvedAudioPlan } from "@/lib/exporter/audioRoutingEngine";
import { estimateCompanionAudioStartDelaySeconds } from "@/lib/mediaTiming";
import { AudioMediaProcessor } from "./audioMediaProcessor";
import {
	AUDIO_BITRATE,
	ENCODE_BACKPRESSURE_LIMIT,
	getSourceTrackIdFromPath,
	MP4_AUDIO_CODEC,
	OFFLINE_AUDIO_SAMPLE_RATE,
	OFFLINE_CHUNK_DURATION_SEC,
	OFFLINE_ENCODE_CHUNK_FRAMES,
	type PreparedOfflineRender,
	resolveSourceTrackGain,
	softLimitOfflineMixPeaksInPlace,
	type TimelineSlice,
	type TrimLikeRegion,
} from "./audioProcessorShared";
import type { VideoMuxer } from "./muxer";

export class OfflineAudioProcessor extends AudioMediaProcessor {
	protected async renderAndMuxOfflineAudio(
		videoUrl: string,
		trimRegions: TrimLikeRegion[],
		speedRegions: SpeedRegion[],
		audioRegions: AudioRegion[],
		sourceAudioFallbackPaths: string[],
		sourceAudioFallbackStartDelayMsByPath: Record<string, number> | undefined,
		sourceAudioTrackSettings: SourceAudioTrackSettings | undefined,
		clipRegions: ClipRegion[] | undefined,
		muxer: VideoMuxer,
	): Promise<void> {
		const prepared = await this.prepareOfflineRender(
			videoUrl,
			trimRegions,
			speedRegions,
			audioRegions,
			sourceAudioFallbackPaths,
			sourceAudioFallbackStartDelayMsByPath,
			sourceAudioTrackSettings,
			clipRegions,
		);
		if (this.cancelled) return;
		await this.renderAndEncodeChunked(prepared, muxer);
	}

	protected async prepareOfflineRender(
		videoUrl: string,
		trimRegions: TrimLikeRegion[],
		speedRegions: SpeedRegion[],
		audioRegions: AudioRegion[],
		sourceAudioFallbackPaths: string[],
		sourceAudioFallbackStartDelayMsByPath?: Record<string, number>,
		sourceAudioTrackSettings?: SourceAudioTrackSettings,
		clipRegions?: ClipRegion[],
	): Promise<PreparedOfflineRender> {
		if (this.cancelled) throw new Error("Export cancelled");
		this.onProgress?.(0);

		const resolvedPlan = buildResolvedAudioPlan({
			videoResource: videoUrl,
			sourceAudioFallbackPaths,
			audioRegions,
			sourceTrackGainById: {
				mic: resolveSourceTrackGain(sourceAudioTrackSettings, "mic"),
				system: resolveSourceTrackGain(sourceAudioTrackSettings, "system"),
				mixed: resolveSourceTrackGain(sourceAudioTrackSettings, "mixed"),
			},
			embeddedGain: Math.max(
				0,
				Math.min(
					2,
					sourceAudioTrackSettings?.mixed
						? resolveSourceTrackGain(sourceAudioTrackSettings, "mixed")
						: sourceAudioTrackSettings?.system
							? resolveSourceTrackGain(sourceAudioTrackSettings, "system")
							: 1,
				),
			),
		});

		// Decode embedded source audio separately from companion sidecars.
		const mainBuffer = resolvedPlan.includeEmbeddedInExport
			? await this.decodeAudioFromUrl(videoUrl)
			: null;
		const mainBufferGain = resolveSourceTrackGain(sourceAudioTrackSettings, "mixed");
		const mainBufferEntry = mainBuffer ? { buffer: mainBuffer, gain: mainBufferGain } : null;
		if (this.cancelled) throw new Error("Export cancelled");

		// Decode companion / sidecar audio files
		const companionEntries: Array<{
			buffer: AudioBuffer;
			startDelaySec: number;
			gain: number;
		}> = [];
		const mediaDuration =
			mainBuffer?.duration ??
			(resolvedPlan.playbackPaths.length > 0 || audioRegions.length > 0
				? await this.getMediaDurationSec(videoUrl)
				: 0);
		const refDuration = mediaDuration;
		for (const audioPath of resolvedPlan.playbackPaths) {
			if (this.cancelled) throw new Error("Export cancelled");
			const buffer = await this.decodeAudioFromUrl(audioPath);
			if (!buffer) continue;

			companionEntries.push({
				buffer,
				gain: resolveSourceTrackGain(
					sourceAudioTrackSettings,
					getSourceTrackIdFromPath(audioPath),
				),
				startDelaySec: estimateCompanionAudioStartDelaySeconds(
					refDuration,
					buffer.duration,
					sourceAudioFallbackStartDelayMsByPath?.[audioPath],
				),
			});
		}
		if (this.cancelled) throw new Error("Export cancelled");

		// Decode audio region overlay files
		const regionEntries: Array<{ buffer: AudioBuffer; region: AudioRegion }> = [];
		for (const region of audioRegions) {
			if (this.cancelled) throw new Error("Export cancelled");
			const buffer = await this.decodeAudioFromUrl(region.audioPath);
			if (buffer) regionEntries.push({ buffer, region });
		}

		this.onProgress?.(0.2);

		// Determine source duration for timeline calculation
		const primaryBuffer = mainBufferEntry?.buffer ?? companionEntries[0]?.buffer ?? null;
		if (!primaryBuffer && regionEntries.length === 0) {
			throw new Error("No decodable audio sources found");
		}

		let sourceDurationSec: number;
		if (mainBufferEntry?.buffer) {
			sourceDurationSec = mainBufferEntry.buffer.duration;
		} else if (resolvedPlan.playbackPaths.length > 0 || regionEntries.length > 0) {
			sourceDurationSec = Math.max(
				mediaDuration > 0 ? mediaDuration : 0,
				primaryBuffer?.duration ?? 0,
			);
		} else {
			sourceDurationSec = primaryBuffer?.duration ?? 0;
		}
		const sourceDurationMs = sourceDurationSec * 1000;

		// Build timeline slices (non-trimmed segments with speed info)
		const slices = clipRegions
			? clipRegions.map((clip) => ({
					sourceStartMs: getClipSourceStartMs(clip),
					sourceEndMs: getClipSourceEndMs(clip),
					speed: clip.speed,
					outputStartMs: clip.startMs,
				}))
			: this.buildTimelineSlices(sourceDurationMs, trimRegions, speedRegions);

		let outputDurationMs = 0;
		for (const slice of slices) {
			outputDurationMs += (slice.sourceEndMs - slice.sourceStartMs) / slice.speed;
		}
		if (clipRegions) outputDurationMs = getTimelineDurationMs(clipRegions, sourceDurationMs);

		// Extend for audio regions that might exceed the video timeline
		for (const { region } of regionEntries) {
			const regionEndOutput = clipRegions
				? region.endMs
				: this.sourceTimeToOutputTime(region.endMs, slices);
			outputDurationMs = Math.max(outputDurationMs, regionEndOutput);
		}

		const numChannels = Math.min(primaryBuffer?.numberOfChannels ?? 2, 2);
		const mutedSourceOutputRangesSec = (clipRegions ?? [])
			.filter(
				(clip) =>
					Boolean(clip.muted) &&
					Number.isFinite(clip.startMs) &&
					Number.isFinite(clip.endMs) &&
					clip.endMs > clip.startMs,
			)
			.map((clip) => ({
				startSec: Math.max(0, clip.startMs / 1000),
				endSec: Math.max(0, clip.endMs / 1000),
			}));

		return {
			usesClipTimeline: clipRegions !== undefined,
			mainBufferEntry,
			companionEntries,
			regionEntries,
			mutedSourceOutputRangesSec,
			slices,
			outputDurationMs,
			numChannels,
		};
	}

	// Render timeline in chunks and encode each chunk to the muxer immediately.
	// Memory is bounded to ~OFFLINE_CHUNK_DURATION_SEC of PCM per chunk
	// instead of holding the entire output buffer in memory.
	protected async renderAndEncodeChunked(
		prepared: PreparedOfflineRender,
		muxer: VideoMuxer,
	): Promise<void> {
		const { numChannels } = prepared;
		const totalOutputSec = Math.max(prepared.outputDurationMs / 1000, 0.01);

		let encodeError: Error | null = null;
		let muxError: Error | null = null;
		const getEncodeError = (): Error | null => encodeError;
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
						if (this.cancelled) return;
						await muxer.addAudioChunk(chunk, !wroteFirstChunk ? meta : undefined);
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

		let totalFramesEncoded = 0;

		try {
			await this.renderChunked(
				prepared,
				totalOutputSec,
				async (rendered, outputOffsetSec) => {
					if (encodeError) throw encodeError;
					if (muxError) throw muxError;
					const frames = await this.feedBufferToEncoder(
						encoder,
						rendered,
						outputOffsetSec,
					);
					totalFramesEncoded += frames;
				},
			);

			if (encodeError) throw encodeError;
			if (muxError) throw muxError;

			if (totalFramesEncoded > 0 && encoder.state === "configured") {
				try {
					await encoder.flush();
				} catch (flushError) {
					console.warn(
						"[OfflineAudioProcessor] Non-fatal audio encoder flush warning:",
						flushError,
					);
				}
			}

			await pendingMuxing;

			const finalEncodeError = getEncodeError();
			const isIgnorableFlushError =
				wroteFirstChunk && Boolean(finalEncodeError?.message.includes("Flushing error"));
			if (finalEncodeError && !isIgnorableFlushError) throw finalEncodeError;
			if (muxError) throw muxError;
		} finally {
			if (encoder.state === "configured") {
				encoder.close();
			}
		}
	}

	// Render timeline to a WAV blob for the native/FFmpeg export path.
	// Processes in chunks to avoid holding the entire output in memory.
	protected async renderToWavBlobChunked(prepared: PreparedOfflineRender): Promise<Blob> {
		const totalOutputSec = Math.max(prepared.outputDurationMs / 1000, 0.01);
		const totalFrames = Math.ceil(totalOutputSec * OFFLINE_AUDIO_SAMPLE_RATE);
		const numChannels = prepared.numChannels;

		const header = this.createWavHeader(OFFLINE_AUDIO_SAMPLE_RATE, numChannels, totalFrames);
		const pcmParts: ArrayBuffer[] = [header];

		await this.renderChunked(prepared, totalOutputSec, async (rendered) => {
			pcmParts.push(...this.audioBufferToPcmParts(rendered));
		});
		if (this.cancelled) throw new Error("Export cancelled");

		return new Blob(pcmParts, { type: "audio/wav" });
	}

	// Shared chunked rendering loop. Processes the timeline in
	// OFFLINE_CHUNK_DURATION_SEC segments, calling onChunk for each rendered buffer.
	protected async renderChunked(
		prepared: PreparedOfflineRender,
		totalOutputSec: number,
		onChunk: (
			rendered: AudioBuffer,
			outputOffsetSec: number,
			chunkIndex: number,
		) => Promise<void>,
	): Promise<void> {
		const { slices, numChannels } = prepared;
		let outputOffsetSec = 0;
		const chunkCount = Math.ceil(totalOutputSec / OFFLINE_CHUNK_DURATION_SEC);

		for (let i = 0; i < chunkCount && !this.cancelled; i++) {
			const chunkSec = Math.min(OFFLINE_CHUNK_DURATION_SEC, totalOutputSec - outputOffsetSec);
			const chunkFrames = Math.ceil(chunkSec * OFFLINE_AUDIO_SAMPLE_RATE);

			const offlineCtx = new OfflineAudioContext(
				numChannels,
				chunkFrames,
				OFFLINE_AUDIO_SAMPLE_RATE,
			);

			// Schedule main audio
			if (prepared.mainBufferEntry) {
				this.scheduleBufferThroughTimeline(
					offlineCtx,
					prepared.mainBufferEntry.buffer,
					slices,
					0,
					prepared.mainBufferEntry.gain,
					outputOffsetSec,
					chunkSec,
					prepared.mutedSourceOutputRangesSec,
				);
			}

			// Schedule companion/sidecar audio
			for (const entry of prepared.companionEntries) {
				this.scheduleBufferThroughTimeline(
					offlineCtx,
					entry.buffer,
					slices,
					entry.startDelaySec,
					entry.gain,
					outputOffsetSec,
					chunkSec,
					prepared.mutedSourceOutputRangesSec,
				);
			}

			// Schedule audio region overlays
			for (const { buffer, region } of prepared.regionEntries) {
				this.scheduleRegionForChunk(
					offlineCtx,
					buffer,
					region,
					slices,
					outputOffsetSec,
					chunkSec,
					prepared.usesClipTimeline,
				);
			}

			const rendered = await offlineCtx.startRendering();
			if (this.cancelled) break;
			softLimitOfflineMixPeaksInPlace(rendered);

			await onChunk(rendered, outputOffsetSec, i);

			outputOffsetSec += chunkSec;
			this.onProgress?.(0.3 + (outputOffsetSec / totalOutputSec) * 0.7);
		}
	}

	// Schedule an audio region overlay clipped to a specific chunk window.
	protected scheduleRegionForChunk(
		ctx: OfflineAudioContext,
		buffer: AudioBuffer,
		region: AudioRegion,
		slices: TimelineSlice[],
		chunkOutputStartSec: number,
		chunkDurationSec: number,
		usesClipTimeline = false,
	): void {
		const outputStartMs = usesClipTimeline
			? region.startMs
			: this.sourceTimeToOutputTime(region.startMs, slices);
		const outputEndMs = usesClipTimeline
			? region.endMs
			: this.sourceTimeToOutputTime(region.endMs, slices);

		let localStartSec = outputStartMs / 1000 - chunkOutputStartSec;
		let localEndSec = outputEndMs / 1000 - chunkOutputStartSec;

		// Skip if region doesn't overlap with this chunk
		if (localEndSec <= 0 || localStartSec >= chunkDurationSec) return;

		// Clip to chunk bounds
		let bufferOffsetSec = 0;
		if (localStartSec < 0) {
			bufferOffsetSec = -localStartSec;
			localStartSec = 0;
		}
		if (localEndSec > chunkDurationSec) {
			localEndSec = chunkDurationSec;
		}

		const duration = Math.min(localEndSec - localStartSec, buffer.duration - bufferOffsetSec);
		if (duration <= 0.001) return;

		const gainNode = ctx.createGain();
		const normalizeGain = region.normalize ? SOURCE_AUDIO_NORMALIZE_GAIN : 1;
		gainNode.gain.value = Math.max(0, Math.min(1, region.volume * normalizeGain));
		gainNode.connect(ctx.destination);

		const source = ctx.createBufferSource();
		source.buffer = buffer;
		source.connect(gainNode);
		source.start(localStartSec, bufferOffsetSec, duration);
	}

	// Feed a rendered AudioBuffer chunk to an AudioEncoder with a timestamp offset.
	protected async feedBufferToEncoder(
		encoder: AudioEncoder,
		buffer: AudioBuffer,
		timestampOffsetSec: number,
	): Promise<number> {
		const sampleRate = buffer.sampleRate;
		const numChannels = buffer.numberOfChannels;
		const totalFrames = buffer.length;
		let encodedFrames = 0;

		for (
			let offset = 0;
			offset < totalFrames && !this.cancelled;
			offset += OFFLINE_ENCODE_CHUNK_FRAMES
		) {
			const frameCount = Math.min(OFFLINE_ENCODE_CHUNK_FRAMES, totalFrames - offset);

			const planarData = new Float32Array(frameCount * numChannels);
			for (let ch = 0; ch < numChannels; ch++) {
				const channelData = buffer.getChannelData(ch);
				planarData.set(channelData.subarray(offset, offset + frameCount), ch * frameCount);
			}

			const audioData = new AudioData({
				format: "f32-planar",
				sampleRate,
				numberOfFrames: frameCount,
				numberOfChannels: numChannels,
				timestamp: Math.round((offset / sampleRate + timestampOffsetSec) * 1_000_000),
				data: planarData,
			});

			encoder.encode(audioData);
			audioData.close();
			encodedFrames += frameCount;

			while (encoder.encodeQueueSize >= ENCODE_BACKPRESSURE_LIMIT && !this.cancelled) {
				await new Promise((r) => setTimeout(r, 1));
			}
		}

		return encodedFrames;
	}

	// Decode audio from a URL using streaming WebCodecs decode with bulk fallback.
	// Streaming decode avoids holding the full compressed file in memory alongside
	// the decoded AudioBuffer, reducing peak memory for large recordings.
}
