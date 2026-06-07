import type { ExtensionExportAudioCue, ExtensionHost } from "@/lib/extensions/extensionHost";
import type { ExtensionEvent } from "@/lib/extensions/types";
import type { AudioRegion, CursorTelemetryPoint } from "./types";

export const DEFAULT_EXTENSION_SOUND_CUE_DURATION_MS = 500;

type ExtensionAudioCaptureHost = Pick<
	ExtensionHost,
	| "beginExportAudioCapture"
	| "setExportAudioCaptureTime"
	| "emitEvent"
	| "finishExportAudioCapture"
	| "cancelExportAudioCapture"
>;

export function isExportableCursorInteraction(point: CursorTelemetryPoint): boolean {
	return Boolean(point.interactionType && point.interactionType !== "move");
}

function createCursorClickEvent(point: CursorTelemetryPoint): ExtensionEvent {
	return {
		type: "cursor:click",
		timeMs: point.timeMs,
		data: {
			cx: point.cx,
			cy: point.cy,
			interactionType: point.interactionType,
		},
	};
}

export function extensionAudioCuesToRegions(
	cues: ExtensionExportAudioCue[],
	durationMs = DEFAULT_EXTENSION_SOUND_CUE_DURATION_MS,
): AudioRegion[] {
	const cueDurationMs = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 1;

	return cues.map((cue) => ({
		id: `extension-audio-${cue.id}`,
		startMs: cue.timeMs,
		endMs: cue.timeMs + cueDurationMs,
		audioPath: cue.audioPath,
		volume: cue.volume,
		normalize: false,
	}));
}

export function collectExtensionAudioRegionsForExport(
	extensionHost: ExtensionAudioCaptureHost,
	cursorTelemetry: CursorTelemetryPoint[],
	durationMs = DEFAULT_EXTENSION_SOUND_CUE_DURATION_MS,
): AudioRegion[] {
	extensionHost.beginExportAudioCapture();

	try {
		for (const point of cursorTelemetry) {
			if (!isExportableCursorInteraction(point)) continue;

			extensionHost.setExportAudioCaptureTime(point.timeMs);
			extensionHost.emitEvent(createCursorClickEvent(point));
		}

		return extensionAudioCuesToRegions(extensionHost.finishExportAudioCapture(), durationMs);
	} catch (error) {
		extensionHost.cancelExportAudioCapture();
		throw error;
	}
}
