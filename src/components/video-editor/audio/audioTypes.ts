import type { AudioPeaksData } from "../timeline/core/timelineTypes";

export type SourceAudioTrackId = "mixed" | "system" | "mic" | (string & {});

export interface SourceAudioTrackSetting {
	volume: number;
	normalize: boolean;
}

export type SourceAudioTrackSettings = Record<string, SourceAudioTrackSetting>;

export interface SourceAudioTrackMetaItem {
	id: SourceAudioTrackId;
	label: string;
}

export type SourceAudioTrackMeta = SourceAudioTrackMetaItem[];

export interface SourceAudioMediaInfo {
	durationMs: number;
	sampleRate: number | null;
	channels: number | null;
	hasAudioStream: boolean;
}

export interface SourceAudioTrackWithPeaks extends SourceAudioTrackMetaItem {
	kind: "embedded" | "system" | "mic" | "mixed";
	resourcePath: string | null;
	peaks: AudioPeaksData | null;
	probedDurationMs: number | null;
	waveformAvailable: boolean;
	waveformCoverage?: "full" | "partial" | "none";
}

export const SOURCE_AUDIO_FALLBACK_TOAST_ID = "source-audio-fallback-error";
export const SOURCE_AUDIO_NORMALIZE_GAIN = 1.35;
