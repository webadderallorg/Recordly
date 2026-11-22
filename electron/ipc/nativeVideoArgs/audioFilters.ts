import { ATEMPO_FILTER_EPSILON, buildAtempoFilters } from "../ffmpeg/filters";
import { MAX_EDITED_TRACK_TEMPO_SPEED, MIN_EDITED_TRACK_TEMPO_SPEED } from "./constants";
import {
	type NativeVideoExportAudioSegment,
	type NativeVideoExportEditedTrackSegment,
} from "./types";

export function formatFfmpegSeconds(milliseconds: number): string {
	return (milliseconds / 1000).toFixed(3);
}

export function buildTrimmedSourceAudioFilter(
	segments: NativeVideoExportAudioSegment[],
): string | null {
	if (segments.length === 0) {
		return null;
	}

	const filterParts: string[] = [];
	const segmentLabels: string[] = [];

	segments.forEach((segment, index) => {
		const label = `trimmed_audio_${index}`;
		filterParts.push(
			`[1:a]atrim=start=${formatFfmpegSeconds(segment.startMs)}:end=${formatFfmpegSeconds(segment.endMs)},asetpts=PTS-STARTPTS[${label}]`,
		);
		segmentLabels.push(`[${label}]`);
	});

	if (segmentLabels.length === 1) {
		filterParts.push(`${segmentLabels[0]}anull[aout]`);
	} else {
		filterParts.push(`${segmentLabels.join("")}concat=n=${segmentLabels.length}:v=0:a=1[aout]`);
	}

	return filterParts.join(";");
}

export function buildEditedTrackSourceAudioFilter(
	segments: NativeVideoExportEditedTrackSegment[],
	sourceSampleRate: number,
): string | null {
	if (segments.length === 0 || !Number.isFinite(sourceSampleRate) || sourceSampleRate <= 0) {
		return null;
	}

	const normalizedSourceSampleRate = Math.round(sourceSampleRate);
	if (normalizedSourceSampleRate < 1) {
		return null;
	}

	const filterParts: string[] = [];
	const segmentLabels: string[] = [];
	let hasInvalidSegment = false;

	segments.forEach((segment, index) => {
		if (
			!Number.isFinite(segment.startMs) ||
			!Number.isFinite(segment.endMs) ||
			segment.startMs < 0 ||
			segment.endMs < 0
		) {
			hasInvalidSegment = true;
			return;
		}

		if (segment.endMs - segment.startMs <= 0.5) {
			hasInvalidSegment = true;
			return;
		}

		const label = `edited_audio_${index}`;
		const speed = segment.speed;
		if (
			!Number.isFinite(speed) ||
			speed < MIN_EDITED_TRACK_TEMPO_SPEED ||
			speed > MAX_EDITED_TRACK_TEMPO_SPEED
		) {
			hasInvalidSegment = true;
			return;
		}

		const segmentFilter = [
			`[1:a]atrim=start=${formatFfmpegSeconds(segment.startMs)}:end=${formatFfmpegSeconds(segment.endMs)}`,
			"asetpts=PTS-STARTPTS",
		];

		const tempoFilters = buildAtempoFilters(speed);
		if (tempoFilters.length > 0) {
			segmentFilter.push(...tempoFilters);
		} else if (Math.abs(speed - 1) > ATEMPO_FILTER_EPSILON) {
			hasInvalidSegment = true;
			return;
		}

		filterParts.push(`${segmentFilter.join(",")}[${label}]`);
		segmentLabels.push(`[${label}]`);
	});

	if (hasInvalidSegment || segmentLabels.length === 0) {
		return null;
	}

	if (segmentLabels.length === 1) {
		filterParts.push(`${segmentLabels[0]}anull[aout]`);
	} else {
		filterParts.push(`${segmentLabels.join("")}concat=n=${segmentLabels.length}:v=0:a=1[aout]`);
	}

	return filterParts.join(";");
}

export function getEditedAudioExtension(mimeType?: string | null): string {
	if (!mimeType) {
		return ".webm";
	}

	if (mimeType.includes("wav")) {
		return ".wav";
	}

	if (mimeType.includes("mp4") || mimeType.includes("m4a")) {
		return ".m4a";
	}

	if (mimeType.includes("ogg")) {
		return ".ogg";
	}

	return ".webm";
}
