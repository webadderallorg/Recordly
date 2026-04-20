import { WebDemuxer } from "web-demuxer";
import type {
	AudioRegion,
	SpeedRegion,
} from "@/components/video-editor/types";
import type { VideoMuxer } from "../muxer";
import { loadAudioFileDemuxer } from "./decoding";
import {
	prepareOfflineRender,
	renderAndEncodeChunked,
	renderToWavBlobChunked,
} from "./offlineRender";
import {
	AUDIO_BITRATE,
	MIN_SPEED_REGION_DELTA_MS,
	MP4_AUDIO_CODEC,
	type TrimLikeRegion,
} from "./shared";
import { passthroughAudioStream, processTrimOnlyAudio } from "./trimTranscode";

export async function isAacAudioEncodingSupported(
	sampleRate = 48_000,
	numberOfChannels = 2,
): Promise<boolean> {
	try {
		const support = await AudioEncoder.isConfigSupported({
			codec: MP4_AUDIO_CODEC,
			sampleRate,
			numberOfChannels,
			bitrate: AUDIO_BITRATE,
		});
		return support.supported === true;
	} catch {
		return false;
	}
}

export class AudioProcessor {
	private cancelled = false;
	private onProgress?: (progress: number) => void;

	setOnProgress(callback: (progress: number) => void) {
		this.onProgress = callback;
	}

	cancel() {
		this.cancelled = true;
	}

	private get cancelledRef(): { current: boolean } {
		// biome-ignore lint: object wrapping is intentional so mutations propagate
		const self = this;
		return {
			get current() {
				return self.cancelled;
			},
		};
	}

	/**
	 * Audio export has two modes:
	 * 1) no speed regions -> fast WebCodecs trim-only pipeline
	 * 2) speed regions present -> pitch-preserving rendered timeline pipeline
	 */
	async process(
		demuxer: WebDemuxer | null,
		muxer: VideoMuxer,
		videoUrl: string,
		trimRegions?: TrimLikeRegion[],
		speedRegions?: SpeedRegion[],
		readEndSec?: number,
		audioRegions?: AudioRegion[],
		sourceAudioFallbackPaths?: string[],
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

		if (
			sortedSpeedRegions.length > 0 ||
			sortedAudioRegions.length > 0 ||
			sortedSourceAudioFallbackPaths.length > 1
		) {
			await this.renderAndMuxOfflineAudio(
				videoUrl,
				sortedTrims,
				sortedSpeedRegions,
				sortedAudioRegions,
				sortedSourceAudioFallbackPaths,
				muxer,
			);
			return;
		}

		if (sortedSourceAudioFallbackPaths.length === 1) {
			const sidecarDemuxer = await loadAudioFileDemuxer(
				sortedSourceAudioFallbackPaths[0],
			);
			if (sidecarDemuxer) {
				try {
					await processTrimOnlyAudio(
						sidecarDemuxer,
						muxer,
						sortedTrims,
						this.cancelledRef,
					);
				} finally {
					try {
						sidecarDemuxer.destroy();
					} catch {
						/* cleanup */
					}
				}
				return;
			}
			console.warn(
				"[AudioProcessor] Fast sidecar demux failed, falling back to offline rendering",
			);
			await this.renderAndMuxOfflineAudio(
				videoUrl,
				sortedTrims,
				[],
				[],
				sortedSourceAudioFallbackPaths,
				muxer,
			);
			return;
		}

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

			const copiedSourceAudio = await passthroughAudioStream(
				audioStream as ReadableStream<EncodedAudioChunk>,
				audioConfig,
				muxer,
				this.cancelledRef,
			);

			if (copiedSourceAudio) {
				return;
			}
		}

		await processTrimOnlyAudio(
			demuxer,
			muxer,
			sortedTrims,
			this.cancelledRef,
			readEndSec,
		);
	}

	async renderEditedAudioTrack(
		videoUrl: string,
		trimRegions?: TrimLikeRegion[],
		speedRegions?: SpeedRegion[],
		audioRegions?: AudioRegion[],
		sourceAudioFallbackPaths?: string[],
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

		const prepared = await prepareOfflineRender(
			videoUrl,
			sortedTrims,
			sortedSpeedRegions,
			sortedAudioRegions,
			sortedSourceAudioFallbackPaths,
			this.cancelledRef,
			this.onProgress,
		);
		return renderToWavBlobChunked(prepared, this.cancelledRef);
	}

	private async renderAndMuxOfflineAudio(
		videoUrl: string,
		trimRegions: TrimLikeRegion[],
		speedRegions: SpeedRegion[],
		audioRegions: AudioRegion[],
		sourceAudioFallbackPaths: string[],
		muxer: VideoMuxer,
	): Promise<void> {
		const prepared = await prepareOfflineRender(
			videoUrl,
			trimRegions,
			speedRegions,
			audioRegions,
			sourceAudioFallbackPaths,
			this.cancelledRef,
			this.onProgress,
		);
		if (this.cancelled) return;
		await renderAndEncodeChunked(prepared, muxer, this.cancelledRef, this.onProgress);
	}
}
