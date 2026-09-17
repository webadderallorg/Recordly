import { SOURCE_AUDIO_NORMALIZE_GAIN } from "@/components/video-editor/audio/audioTypes";
import type {
	AudioRegion,
	ClipRegion,
	SourceAudioTrackSettings,
	TrimRegion,
} from "@/components/video-editor/types";
import type { SourceTrackId } from "@/lib/exporter/audioRoutingEngine";

export const AUDIO_BITRATE = 128_000;
export const DECODE_BACKPRESSURE_LIMIT = 20;
export const ENCODE_BACKPRESSURE_LIMIT = 20;
export const MIN_SPEED_REGION_DELTA_MS = 0.0001;
export const MP4_AUDIO_CODEC = "mp4a.40.2";
export const OFFLINE_AUDIO_SAMPLE_RATE = 48_000;
export const OFFLINE_ENCODE_CHUNK_FRAMES = 1024;
export const OFFLINE_CHUNK_DURATION_SEC = 30;
const OFFLINE_MIX_SOFT_LIMITER_THRESHOLD = 0.9;
const OFFLINE_MIX_SOFT_LIMITER_CEILING = 0.985;

function softLimitSample(sample: number): number {
	const magnitude = Math.abs(sample);
	if (magnitude <= OFFLINE_MIX_SOFT_LIMITER_THRESHOLD) {
		return sample;
	}

	const sign = sample < 0 ? -1 : 1;
	const kneeRange = 1 - OFFLINE_MIX_SOFT_LIMITER_THRESHOLD;
	const limitedMagnitude =
		OFFLINE_MIX_SOFT_LIMITER_THRESHOLD +
		kneeRange * Math.tanh((magnitude - OFFLINE_MIX_SOFT_LIMITER_THRESHOLD) / kneeRange);
	return sign * Math.min(OFFLINE_MIX_SOFT_LIMITER_CEILING, limitedMagnitude);
}

export function softLimitOfflineMixPeaksInPlace(buffer: AudioBuffer): boolean {
	let changed = false;
	for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
		const data = buffer.getChannelData(channel);
		for (let index = 0; index < data.length; index += 1) {
			const sample = data[index];
			if (!Number.isFinite(sample)) {
				data[index] = 0;
				changed = true;
				continue;
			}

			const limited = softLimitSample(sample);
			if (limited !== sample) {
				data[index] = limited;
				changed = true;
			}
		}
	}
	return changed;
}

export function resolveSourceTrackGain(
	sourceAudioTrackSettings: SourceAudioTrackSettings | undefined,
	trackId: "mic" | "system" | "mixed",
) {
	const settings = sourceAudioTrackSettings?.[trackId];
	if (!settings) {
		return 1;
	}
	const normalizeGain = settings.normalize ? SOURCE_AUDIO_NORMALIZE_GAIN : 1;
	return Math.max(0, Math.min(2, settings.volume * normalizeGain));
}

export function getSourceTrackIdFromPath(audioPath: string): SourceTrackId {
	const normalized = audioPath.toLowerCase();
	// Check for common patterns like .mic., -mic., mic.mp4, etc.
	if (
		normalized.includes(".mic.") ||
		normalized.includes("-mic.") ||
		normalized.includes("_mic_") ||
		normalized.includes("/mic.") ||
		normalized.includes("\\mic.") ||
		normalized.endsWith("mic.mp4") ||
		normalized.endsWith("mic.m4a") ||
		normalized.endsWith("mic.wav")
	) {
		return "mic";
	}
	if (
		normalized.includes(".system.") ||
		normalized.includes("-system.") ||
		normalized.includes("_system_") ||
		normalized.includes("/system.") ||
		normalized.includes("\\system.") ||
		normalized.endsWith("system.mp4") ||
		normalized.endsWith("system.m4a") ||
		normalized.endsWith("system.wav")
	) {
		return "system";
	}
	return "mixed";
}

export function isWavAudioPath(audioPath: string | null | undefined): boolean {
	if (!audioPath) {
		return false;
	}
	const normalized = audioPath.toLowerCase().trim();
	if (normalized.endsWith(".wav")) {
		return true;
	}
	try {
		const parsedUrl = new URL(audioPath, "http://localhost");
		const pathParam = parsedUrl.searchParams.get("path");
		if (pathParam && pathParam.toLowerCase().trim().endsWith(".wav")) {
			return true;
		}
		if (parsedUrl.pathname.toLowerCase().endsWith(".wav")) {
			return true;
		}
	} catch {
		const beforeQuery = normalized.split("?")[0];
		if (beforeQuery.endsWith(".wav")) {
			return true;
		}
	}
	return false;
}

export function hasNonDefaultSourceTrackSettings(
	sourceAudioTrackSettings?: SourceAudioTrackSettings,
) {
	if (!sourceAudioTrackSettings) {
		return false;
	}
	return Object.values(sourceAudioTrackSettings).some(
		(settings) =>
			Math.abs((settings?.volume ?? 1) - 1) > 0.0005 || Boolean(settings?.normalize),
	);
}

export interface TimelineSlice {
	outputStartMs?: number;
	sourceStartMs: number;
	sourceEndMs: number;
	speed: number;
}

export interface PreparedOfflineRender {
	usesClipTimeline?: boolean;
	mainBufferEntry: { buffer: AudioBuffer; gain: number } | null;
	companionEntries: Array<{ buffer: AudioBuffer; startDelaySec: number; gain: number }>;
	regionEntries: Array<{ buffer: AudioBuffer; region: AudioRegion }>;
	mutedSourceOutputRangesSec: Array<{ startSec: number; endSec: number }>;
	slices: TimelineSlice[];
	outputDurationMs: number;
	numChannels: number;
}

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

export type TrimLikeRegion = TrimRegion | ClipRegion;
