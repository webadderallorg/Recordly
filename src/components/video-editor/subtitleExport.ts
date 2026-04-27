import type { CaptionCue } from "./types";

export type SubtitleExportFormat = "srt" | "vtt";

function normalizeSubtitleText(text: string) {
	return text.replace(/\s+/g, " ").trim();
}

function toTimestampParts(timeMs: number) {
	const clampedMs = Math.max(0, Math.round(timeMs));
	const hours = Math.floor(clampedMs / 3_600_000);
	const minutes = Math.floor((clampedMs % 3_600_000) / 60_000);
	const seconds = Math.floor((clampedMs % 60_000) / 1000);
	const milliseconds = clampedMs % 1000;

	return {
		hours: String(hours).padStart(2, "0"),
		minutes: String(minutes).padStart(2, "0"),
		seconds: String(seconds).padStart(2, "0"),
		milliseconds: String(milliseconds).padStart(3, "0"),
	};
}

export function formatSubtitleTimestamp(timeMs: number, format: SubtitleExportFormat) {
	const { hours, minutes, seconds, milliseconds } = toTimestampParts(timeMs);
	const separator = format === "srt" ? "," : ".";
	return `${hours}:${minutes}:${seconds}${separator}${milliseconds}`;
}

function getExportableCues(cues: CaptionCue[]) {
	return cues
		.map((cue) => ({
			...cue,
			startMs: Math.max(0, Math.round(cue.startMs)),
			endMs: Math.max(0, Math.round(cue.endMs)),
			text: normalizeSubtitleText(cue.text),
		}))
		.filter((cue) => cue.text.length > 0 && cue.endMs > cue.startMs)
		.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

export function serializeCaptionsAsSrt(cues: CaptionCue[]) {
	return getExportableCues(cues)
		.map((cue, index) => {
			const start = formatSubtitleTimestamp(cue.startMs, "srt");
			const end = formatSubtitleTimestamp(cue.endMs, "srt");
			return `${index + 1}\n${start} --> ${end}\n${cue.text}`;
		})
		.join("\n\n");
}

export function serializeCaptionsAsWebVtt(cues: CaptionCue[]) {
	const body = getExportableCues(cues)
		.map((cue) => {
			const start = formatSubtitleTimestamp(cue.startMs, "vtt");
			const end = formatSubtitleTimestamp(cue.endMs, "vtt");
			return `${start} --> ${end}\n${cue.text}`;
		})
		.join("\n\n");

	return body ? `WEBVTT\n\n${body}\n` : "WEBVTT\n";
}

export function serializeCaptions(cues: CaptionCue[], format: SubtitleExportFormat) {
	return format === "vtt" ? serializeCaptionsAsWebVtt(cues) : serializeCaptionsAsSrt(cues);
}
