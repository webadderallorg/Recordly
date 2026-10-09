import type { CursorTelemetryPoint, ZoomFocus, ZoomRegion } from "../types";
import { ZOOM_DEPTH_SCALES } from "../types";
import { DEFAULT_FOCUS } from "./constants";
import {
	type CursorFollowCameraState,
	computeCursorFollowFocus,
	SNAP_TO_EDGES_RATIO_AUTO,
} from "./cursorFollowCamera";
import { findDominantRegion } from "./zoomRegionUtils";
import { resolveRegion3DState, ZERO_CAMERA_3D_STATE, type Camera3DState } from "./camera3d";

export type SceneZoomTarget = {
	scale: number;
	focus: ZoomFocus;
	progress: number;
	/**
	 * The dominant region's 3D move, already resolved. Present on every target
	 * so all three renderers (preview and both exporters) read the 3D state
	 * from this one shared resolver rather than re-deriving it from the region
	 * list — that is what keeps preview and export in agreement.
	 */
	move3d: Camera3DState;
};

export type PreviewMotionMode = "spring" | "snap" | "preserve";

/**
 * Decide how the preview camera should react to the current transport state.
 * A plain pause must preserve the last composed frame; recomputing the projected
 * target there causes the image to jump as soon as the user presses Space.
 */
export function resolvePreviewMotionMode({
	isPlaying,
	isSeeking,
	shouldSnapPausedFrame,
	zoomClassicMode,
}: {
	isPlaying: boolean;
	isSeeking: boolean;
	shouldSnapPausedFrame: boolean;
	zoomClassicMode: boolean;
}): PreviewMotionMode {
	if (isSeeking || shouldSnapPausedFrame || (isPlaying && zoomClassicMode)) {
		return "snap";
	}

	return isPlaying ? "spring" : "preserve";
}

/** Match export's one-composition-per-media-frame behavior. */
export function shouldComposePreviewFrame({
	motionMode,
	isSeeking = false,
	contentTimeChanged,
	shouldSnapPausedFrame,
}: {
	motionMode: PreviewMotionMode;
	isSeeking?: boolean;
	contentTimeChanged: boolean;
	shouldSnapPausedFrame: boolean;
}): boolean {
	// Do not consume the pending composition against the old decoded image.
	if (isSeeking || motionMode === "preserve") {
		return false;
	}

	return contentTimeChanged || shouldSnapPausedFrame;
}

/** Resolve the camera target for a media timestamp, independent of renderer. */
export function resolveSceneZoomTarget({
	zoomRegions,
	timeMs,
	cursorTimeMs = timeMs,
	connectZooms,
	zoomInDurationMs,
	zoomOutDurationMs,
	zoomClassicMode,
	cursorTelemetry,
	cursorFollowCamera,
	zoom3DEnabled = true,
}: {
	zoomRegions: ZoomRegion[];
	timeMs: number;
	cursorTimeMs?: number;
	connectZooms?: boolean;
	zoomInDurationMs?: number;
	zoomOutDurationMs?: number;
	zoomClassicMode?: boolean;
	cursorTelemetry?: CursorTelemetryPoint[];
	cursorFollowCamera: CursorFollowCameraState;
	/**
	 * Global 2D/3D switch. When false the 3D move is resolved out entirely, so
	 * every region plays as a plain 2D zoom regardless of its own `move3d`.
	 * Defaults to true so 3D is opt-out and existing 3D projects keep working.
	 */
	zoom3DEnabled?: boolean;
}): SceneZoomTarget {
	const { region, strength, blendedScale } = findDominantRegion(zoomRegions, timeMs, {
		connectZooms,
		zoomInDurationMs,
		zoomOutDurationMs,
	});

	if (!region || strength <= 0) {
		return { scale: 1, focus: DEFAULT_FOCUS, progress: 0, move3d: ZERO_CAMERA_3D_STATE };
	}

	const scale = blendedScale ?? ZOOM_DEPTH_SCALES[region.depth];
	let focus = region.focus;
	if (
		!zoomClassicMode &&
		region.mode !== "manual" &&
		cursorTelemetry &&
		cursorTelemetry.length > 0
	) {
		focus = computeCursorFollowFocus(
			cursorFollowCamera,
			cursorTelemetry,
			cursorTimeMs,
			scale,
			strength,
			region.focus,
			{ snapToEdgesRatio: SNAP_TO_EDGES_RATIO_AUTO },
		);
	}

	return {
		scale,
		focus,
		progress: strength,
		// Gate here, at the one place all three renderers read from, so the switch
		// can never make the preview disagree with an export.
		move3d: zoom3DEnabled
			? resolveRegion3DState(region.move3d)
			: ZERO_CAMERA_3D_STATE,
	};
}
