import type { WebDemuxer } from "web-demuxer";
import { requiresClipTimelineRendering } from "./clipTimeline";
import type {
	AudioRegion,
	ClipRegion,
	SourceAudioTrackSettings,
	SpeedRegion,
} from "@/components/video-editor/types";
import { resolveSourceTrackRoutingPolicy } from "./sourceTrackRoutingPolicy";
import { AudioTranscodeProcessor } from "./audioTranscodeProcessor";
import {
	hasNonDefaultSourceTrackSettings,
	isWavAudioPath,
	MIN_SPEED_REGION_DELTA_MS,
	MP4_AUDIO_CODEC,
	type TrimLikeRegion,
} from "./audioProcessorShared";
import type { VideoMuxer } from "./muxer";

export {
	getSourceTrackIdFromPath,
	hasNonDefaultSourceTrackSettings,
	isAacAudioEncodingSupported,
	isWavAudioPath,
	softLimitOfflineMixPeaksInPlace,
} from "./audioProcessorShared";

export class AudioProcessor extends AudioTranscodeProcessor {
	private isPassthroughAudioCodec(codec: string | undefined): boolean {
		if (!codec) {
			return false;
		}

		const normalizedCodec = codec.toLowerCase();
		return (
			normalizedCodec === MP4_AUDIO_CODEC ||
			normalizedCodec === "aac" ||
			normalizedCodec.startsWith("mp4a.40.2")
		);
	}

	protected async passthroughAudioStream(
		audioStream: ReadableStream<EncodedAudioChunk>,
		audioConfig: AudioDecoderConfig,
		muxer: VideoMuxer,
	): Promise<boolean> {
		if (!this.isPassthroughAudioCodec(audioConfig.codec)) {
			return false;
		}

		let reader: ReadableStreamDefaultReader<EncodedAudioChunk> | null = null;
		let wroteAudio = false;
		let passthroughTimestampOffsetUs: number | null = null;

		try {
			reader = audioStream.getReader();
			while (!this.cancelled) {
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
						: this.cloneEncodedAudioChunkWithTimestamp(chunk, normalizedTimestamp);

				await muxer.addAudioChunk(
					outputChunk,
					wroteAudio
						? undefined
						: {
								decoderConfig: audioConfig,
							},
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

	/**
	 * Audio export has two modes:
	 * 1) no speed regions -> fast WebCodecs trim-only pipeline
	 * 2) speed regions present -> pitch-preserving rendered timeline pipeline
	 */
	setOnProgress(callback: (progress: number) => void) {
		this.onProgress = callback;
	}

	async process(
		demuxer: WebDemuxer | null,
		muxer: VideoMuxer,
		videoUrl: string,
		trimRegions?: TrimLikeRegion[],
		speedRegions?: SpeedRegion[],
		readEndSec?: number,
		audioRegions?: AudioRegion[],
		sourceAudioFallbackPaths?: string[],
		sourceAudioFallbackStartDelayMsByPath?: Record<string, number>,
		sourceAudioTrackSettings?: SourceAudioTrackSettings,
		clipRegions?: ClipRegion[],
	): Promise<void> {
		const sortedTrims = trimRegions
			? [...trimRegions].sort((a, b) => a.startMs - b.startMs)
			: [];
		const sortedSpeedRegions = speedRegions
			? [...speedRegions]
					.filter((region) => region.endMs - region.startMs > MIN_SPEED_REGION_DELTA_MS)
					.sort((a, b) => a.startMs - b.startMs)
			: [];
		const sortedAudioRegions = audioRegions
			? [...audioRegions].sort((a, b) => a.startMs - b.startMs)
			: [];
		const sortedSourceAudioFallbackPaths = sourceAudioFallbackPaths
			? sourceAudioFallbackPaths.filter(
					(audioPath) => typeof audioPath === "string" && audioPath.trim().length > 0,
				)
			: [];
		const routingPolicy = resolveSourceTrackRoutingPolicy(
			videoUrl,
			sortedSourceAudioFallbackPaths,
		);
		const requiresLegacyMacMicSidecarMix =
			routingPolicy.includeEmbeddedInExport &&
			!routingPolicy.hasEmbeddedSourceAudio &&
			routingPolicy.playbackPaths.length === 1 &&
			routingPolicy.playbackPaths[0]?.toLowerCase().endsWith(".mic.m4a") === true;
		const hasTimedCompanionAudio = routingPolicy.playbackPaths.some(
			(audioPath) => (sourceAudioFallbackStartDelayMsByPath?.[audioPath] ?? 0) > 0,
		);
		const hasWavCompanionAudio = routingPolicy.playbackPaths.some((audioPath) =>
			isWavAudioPath(audioPath),
		);
		const needsSourceAudioMixing =
			routingPolicy.playbackPaths.length > 1 ||
			(routingPolicy.hasEmbeddedSourceAudio && routingPolicy.playbackPaths.length > 0) ||
			requiresLegacyMacMicSidecarMix ||
			hasTimedCompanionAudio ||
			hasWavCompanionAudio;

		// When speed edits, audio regions, or multiple audio sources need mixing, use offline AudioContext pipeline.
		if (
			requiresClipTimelineRendering(clipRegions) ||
			sortedSpeedRegions.length > 0 ||
			sortedAudioRegions.length > 0 ||
			needsSourceAudioMixing ||
			hasNonDefaultSourceTrackSettings(sourceAudioTrackSettings) ||
			(clipRegions ?? []).some((clip) => Boolean(clip.muted))
		) {
			await this.renderAndMuxOfflineAudio(
				videoUrl,
				sortedTrims,
				sortedSpeedRegions,
				sortedAudioRegions,
				sortedSourceAudioFallbackPaths,
				sourceAudioFallbackStartDelayMsByPath,
				sourceAudioTrackSettings,
				clipRegions,
				muxer,
			);
			return;
		}

		// Single sidecar audio with no speed/audio edits: demux directly (skips slow real-time rendering).
		if (!routingPolicy.hasEmbeddedSourceAudio && routingPolicy.playbackPaths.length === 1) {
			const sidecarPath = routingPolicy.playbackPaths[0];
			if (!isWavAudioPath(sidecarPath)) {
				const sidecarDemuxer = await this.loadAudioFileDemuxer(sidecarPath);
				if (sidecarDemuxer) {
					let wroteAudio = false;
					try {
						wroteAudio = await this.processTrimOnlyAudio(
							sidecarDemuxer,
							muxer,
							sortedTrims,
						);
					} catch (error) {
						console.warn("[AudioProcessor] Fast sidecar demux failed:", error);
					} finally {
						try {
							sidecarDemuxer.destroy();
						} catch {
							/* cleanup */
						}
					}
					if (wroteAudio) {
						return;
					}
				}
			}
			// Fallback to offline rendering if demuxer creation failed, unsupported codec, or no audio was written
			console.warn(
				"[AudioProcessor] Fast sidecar demux unavailable or failed, falling back to offline rendering",
			);
			await this.renderAndMuxOfflineAudio(
				videoUrl,
				sortedTrims,
				[],
				[],
				routingPolicy.playbackPaths,
				sourceAudioFallbackStartDelayMsByPath,
				sourceAudioTrackSettings,
				clipRegions,
				muxer,
			);
			return;
		}

		// No speed edits or audio regions: keep the original demux/decode/encode path with trim timestamp remap.
		if (!demuxer) {
			console.warn("[AudioProcessor] No demuxer available, skipping audio");
			return;
		}

		if (sortedTrims.length === 0) {
			let audioConfig: AudioDecoderConfig;
			try {
				audioConfig = (await demuxer.getDecoderConfig("audio")) as AudioDecoderConfig;
			} catch {
				console.warn("[AudioProcessor] No audio track found, skipping");
				return;
			}

			const audioStream =
				typeof readEndSec === "number"
					? demuxer.read("audio", 0, readEndSec)
					: demuxer.read("audio");

			const copiedSourceAudio = await this.passthroughAudioStream(
				audioStream as ReadableStream<EncodedAudioChunk>,
				audioConfig,
				muxer,
			);

			if (copiedSourceAudio) {
				return;
			}
		}

		const wroteTrimOnlyAudio = await this.processTrimOnlyAudio(
			demuxer,
			muxer,
			sortedTrims,
			readEndSec,
		);
		if (!wroteTrimOnlyAudio && routingPolicy.playbackPaths.length > 0) {
			console.warn(
				"[AudioProcessor] Main demuxer audio trim failed, falling back to offline rendering for playback paths",
			);
			await this.renderAndMuxOfflineAudio(
				videoUrl,
				sortedTrims,
				[],
				[],
				routingPolicy.playbackPaths,
				sourceAudioFallbackStartDelayMsByPath,
				sourceAudioTrackSettings,
				clipRegions,
				muxer,
			);
		}
	}

	async renderEditedAudioTrack(
		videoUrl: string,
		trimRegions?: TrimLikeRegion[],
		speedRegions?: SpeedRegion[],
		audioRegions?: AudioRegion[],
		sourceAudioFallbackPaths?: string[],
		sourceAudioFallbackStartDelayMsByPath?: Record<string, number>,
		sourceAudioTrackSettings?: SourceAudioTrackSettings,
		clipRegions?: ClipRegion[],
	): Promise<Blob> {
		const sortedTrims = trimRegions
			? [...trimRegions].sort((a, b) => a.startMs - b.startMs)
			: [];
		const sortedSpeedRegions = speedRegions
			? [...speedRegions]
					.filter((region) => region.endMs - region.startMs > MIN_SPEED_REGION_DELTA_MS)
					.sort((a, b) => a.startMs - b.startMs)
			: [];
		const sortedAudioRegions = audioRegions
			? [...audioRegions].sort((a, b) => a.startMs - b.startMs)
			: [];
		const sortedSourceAudioFallbackPaths = sourceAudioFallbackPaths
			? sourceAudioFallbackPaths.filter(
					(audioPath) => typeof audioPath === "string" && audioPath.trim().length > 0,
				)
			: [];

		const prepared = await this.prepareOfflineRender(
			videoUrl,
			sortedTrims,
			sortedSpeedRegions,
			sortedAudioRegions,
			sortedSourceAudioFallbackPaths,
			sourceAudioFallbackStartDelayMsByPath,
			sourceAudioTrackSettings,
			clipRegions,
		);
		return this.renderToWavBlobChunked(prepared);
	}

	// Legacy trim-only path used when no speed regions are configured.
}
