import type { AudioSyncAdjustment, PauseSegment } from "../types";

const MAX_AUDIO_SYNC_DELAY_MS = 15000;

export function buildAtempoFilters(tempoRatio: number): string[] {
	if (!Number.isFinite(tempoRatio) || tempoRatio <= 0) {
		return [];
	}

	const filters: string[] = [];
	let remaining = tempoRatio;

	while (remaining < 0.5) {
		filters.push("atempo=0.5");
		remaining /= 0.5;
	}

	while (remaining > 2) {
		filters.push("atempo=2.0");
		remaining /= 2.0;
	}

	if (Math.abs(remaining - 1) > 0.0005) {
		filters.push(`atempo=${remaining.toFixed(6)}`);
	}

	return filters;
}

export function getAudioSyncAdjustment(
	videoDuration: number,
	audioDuration: number,
): AudioSyncAdjustment {
	if (
		!Number.isFinite(videoDuration) ||
		!Number.isFinite(audioDuration) ||
		videoDuration <= 0 ||
		audioDuration <= 0
	) {
		return { mode: "none", delayMs: 0, tempoRatio: 1, durationDeltaMs: 0 };
	}

	const durationDeltaMs = Math.round((videoDuration - audioDuration) * 1000);
	const absDeltaMs = Math.abs(durationDeltaMs);
	if (absDeltaMs <= 20) {
		return { mode: "none", delayMs: 0, tempoRatio: 1, durationDeltaMs };
	}

	// When the recorded audio runs longer than the video, globally speeding it
	// up can pull speech ahead of the picture. Keep the track anchored at the
	// start instead and let the downstream mux path trim any trailing overrun.
	if (durationDeltaMs < 0) {
		return { mode: "none", delayMs: 0, tempoRatio: 1, durationDeltaMs };
	}

	const tempoRatio = Math.max(0.5, Math.min(2, audioDuration / videoDuration));
	const relativeDelta = absDeltaMs / Math.max(videoDuration * 1000, 1);

	if (relativeDelta <= 0.03 || absDeltaMs <= 1500) {
		return { mode: "tempo", delayMs: 0, tempoRatio, durationDeltaMs };
	}

	if (durationDeltaMs > MAX_AUDIO_SYNC_DELAY_MS) {
		return { mode: "pad", delayMs: 0, tempoRatio: 1, durationDeltaMs };
	}

	return { mode: "delay", delayMs: durationDeltaMs, tempoRatio: 1, durationDeltaMs };
}

export function applyRecordedAudioStartDelay(
	adjustment: AudioSyncAdjustment,
	recordedStartDelayMs?: number | null,
): AudioSyncAdjustment {
	if (!Number.isFinite(recordedStartDelayMs) || (recordedStartDelayMs ?? 0) < 0) {
		return adjustment;
	}

	const delayMs = Math.max(0, Math.round(recordedStartDelayMs ?? 0));
	if (delayMs > 20) {
		return {
			mode: "delay",
			delayMs,
			tempoRatio: 1,
			durationDeltaMs: adjustment.durationDeltaMs,
		};
	}

	if (adjustment.mode !== "delay" && adjustment.mode !== "pad") {
		return adjustment;
	}

	return {
		mode: "pad",
		delayMs: 0,
		tempoRatio: 1,
		durationDeltaMs: adjustment.durationDeltaMs,
	};
}

export function appendSyncedAudioFilter(
	filterParts: string[],
	inputLabel: string,
	outputLabel: string,
	adjustment: AudioSyncAdjustment,
	options: number | { volumeMultiplier?: number; preFilters?: string[] } = 1,
) {
	const volumeMultiplier =
		typeof options === "number" ? options : (options.volumeMultiplier ?? 1);
	const preFilters = typeof options === "number" ? [] : (options.preFilters ?? []);
	const filters: string[] = [...preFilters];

	if (adjustment.mode === "delay" && adjustment.delayMs > 0) {
		filters.push(`adelay=${adjustment.delayMs}|${adjustment.delayMs}`);
	}

	if (adjustment.mode === "tempo") {
		filters.push(...buildAtempoFilters(adjustment.tempoRatio));
	}

	if (adjustment.mode === "pad" && adjustment.durationDeltaMs > 0) {
		filters.push(`apad=pad_dur=${formatFfmpegSeconds(adjustment.durationDeltaMs)}`);
	}

	if (
		Number.isFinite(volumeMultiplier) &&
		volumeMultiplier > 0 &&
		Math.abs(volumeMultiplier - 1) > 0.0005
	) {
		filters.push(`volume=${volumeMultiplier.toFixed(3)}`);
	}

	filters.push("aresample=async=1:first_pts=0", "asetpts=PTS-STARTPTS");
	filterParts.push(`${inputLabel}${filters.join(",")}[${outputLabel}]`);
}

export function formatFfmpegSeconds(milliseconds: number): string {
	return (milliseconds / 1000).toFixed(3);
}

export function normalizePauseSegments(pauseSegments: PauseSegment[] | undefined): PauseSegment[] {
	if (!Array.isArray(pauseSegments) || pauseSegments.length === 0) {
		return [];
	}

	const normalized = pauseSegments
		.map((segment) => {
			const startMs = Number(segment?.startMs);
			const endMs = Number(segment?.endMs);

			if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
				return null;
			}

			const clampedStart = Math.max(0, Math.round(startMs));
			const clampedEnd = Math.max(0, Math.round(endMs));
			if (clampedEnd <= clampedStart) {
				return null;
			}

			return { startMs: clampedStart, endMs: clampedEnd };
		})
		.filter((segment): segment is PauseSegment => !!segment)
		.sort((left, right) => left.startMs - right.startMs);

	if (normalized.length <= 1) {
		return normalized;
	}

	const merged: PauseSegment[] = [{ ...normalized[0] }];

	for (const segment of normalized.slice(1)) {
		const previous = merged[merged.length - 1];
		if (segment.startMs <= previous.endMs) {
			previous.endMs = Math.max(previous.endMs, segment.endMs);
		} else {
			merged.push({ ...segment });
		}
	}

	return merged;
}

export function buildPausedAudioFilter(
	inputLabel: string,
	outputLabel: string,
	pauseSegments: PauseSegment[],
): string | null {
	if (pauseSegments.length === 0) {
		return null;
	}

	const activeSegments: Array<{ startMs: number; endMs?: number }> = [];
	let cursorMs = 0;

	for (const pauseSegment of pauseSegments) {
		if (pauseSegment.startMs > cursorMs) {
			activeSegments.push({ startMs: cursorMs, endMs: pauseSegment.startMs });
		}
		cursorMs = Math.max(cursorMs, pauseSegment.endMs);
	}

	activeSegments.push({ startMs: cursorMs });

	const filterParts: string[] = [];
	const segmentLabels: string[] = [];

	activeSegments.forEach((segment, index) => {
		if (typeof segment.endMs === "number" && segment.endMs <= segment.startMs) {
			return;
		}

		const segmentLabel = `${outputLabel}_part${index}`;
		const trimArgs =
			typeof segment.endMs === "number"
				? `start=${formatFfmpegSeconds(segment.startMs)}:end=${formatFfmpegSeconds(segment.endMs)}`
				: `start=${formatFfmpegSeconds(segment.startMs)}`;

		filterParts.push(`[${inputLabel}]atrim=${trimArgs},asetpts=PTS-STARTPTS[${segmentLabel}]`);
		segmentLabels.push(`[${segmentLabel}]`);
	});

	if (segmentLabels.length === 0) {
		return null;
	}

	if (segmentLabels.length === 1) {
		filterParts.push(`${segmentLabels[0]}anull[${outputLabel}]`);
	} else {
		filterParts.push(
			`${segmentLabels.join("")}concat=n=${segmentLabels.length}:v=0:a=1[${outputLabel}]`,
		);
	}

	return filterParts.join(";");
}

export function parseFfmpegDurationSeconds(stderr: string): number | null {
	const match = stderr.match(/Duration:\s+(\d+):(\d+):(\d+(?:\.\d+)?)/i);
	if (!match) {
		return null;
	}

	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	const seconds = Number(match[3]);
	if (![hours, minutes, seconds].every(Number.isFinite)) {
		return null;
	}

	return hours * 3600 + minutes * 60 + seconds;
}
