import { getTimelineDurationMs, mapSourceTimeToTimelineTime } from "../../types";
import { type EditorOpContext, loadAgentActivity } from "./types";

export type EditorLook = Record<string, unknown>;

const LOOK_FIELDS = [
	"wallpaper",
	"padding",
	"borderRadius",
	"shadowIntensity",
	"backgroundBlur",
	"cropRegion",
	"webcam",
] as const;

const MOTION_FIELDS = [
	"connectZooms",
	"zoomInDurationMs",
	"zoomOutDurationMs",
	"connectedZoomDurationMs",
	"connectedZoomGapMs",
	"zoomInOverlapMs",
	"zoomInEasing",
	"zoomOutEasing",
	"connectedZoomEasing",
	"zoomSmoothness",
	"zoomClassicMode",
	"zoomMotionBlur",
	"showCursor",
	"loopCursor",
	"cursorStyle",
	"cursorSize",
	"cursorSmoothing",
	"cursorMotionBlur",
	"cursorSway",
	"cursorClickEffect",
	"cursorClickEffectScale",
	"cursorClickEffectOpacity",
	"cursorClickEffectDurationMs",
	"cursorClickBounce",
	"cursorClickBounceDuration",
	"zoomMotionBlurTuning",
	"cursorSpringStiffnessMultiplier",
	"cursorSpringDampingMultiplier",
	"cursorSpringMassMultiplier",
	"cameraSpringStiffnessMultiplier",
	"cameraSpringDampingMultiplier",
	"cameraSpringMassMultiplier",
] as const;

function pick(source: Record<string, unknown>, keys: readonly string[]): EditorLook {
	const out: EditorLook = {};
	for (const key of keys) {
		if (source[key] !== undefined) out[key] = source[key];
	}
	return out;
}

function sourceAudioStatus(timeline: EditorOpContext["timeline"]) {
	const tracks = Object.keys(timeline.defaultSourceAudioTrackSettings ?? {});
	if (tracks.length > 0) return "ready" as const;
	return timeline.sourceAudioLoading ? ("loading" as const) : ("none" as const);
}

export async function getEditorState(context: EditorOpContext) {
	const { duration, videoSourcePath, timeline, appearance } = context;
	const sourceDurationMs = Math.round(duration * 1000);
	const durationMs = getTimelineDurationMs(timeline.clipRegions, sourceDurationMs);
	const appearanceRecord = appearance as unknown as Record<string, unknown>;
	const scenes = await loadAgentActivity(
		videoSourcePath,
		"Scene times are only available for a recording an agent drove.",
	).then(
		(log) =>
			log.scenes
				.slice()
				.sort((a, b) => a.startMs - b.startMs)
				.map((scene, index) => ({
					index,
					title: scene.title ?? null,
					failed: scene.failed,
					startMs: mapSourceTimeToTimelineTime(scene.startMs, timeline.clipRegions),
					endMs: mapSourceTimeToTimelineTime(scene.endMs, timeline.clipRegions),
					sourceStartMs: scene.startMs,
					sourceEndMs: scene.endMs,
				})),
		(error: unknown) => ({
			unavailable: error instanceof Error ? error.message : String(error),
		}),
	);
	return {
		videoPath: videoSourcePath,
		durationMs,
		sourceDurationMs,
		clips: timeline.clipRegions,
		zooms: timeline.zoomRegions,
		annotations: timeline.annotationRegions,
		audio: timeline.audioRegions,
		captions: timeline.autoCaptions,
		captionSettings: timeline.autoCaptionSettings,
		speeds: timeline.speedRegions,
		sourceAudio: {
			status: sourceAudioStatus(timeline),
			default: timeline.defaultSourceAudioTrackSettings,
			byClip: timeline.sourceAudioTrackSettingsByClip,
		},
		scenes,
		look: pick(appearanceRecord, LOOK_FIELDS),
		motion: pick(appearanceRecord, MOTION_FIELDS),
		lookUndoable: false,
	};
}
