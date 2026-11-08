import { isCinematicZoomMotion } from "../cursorMotionPresets";
import type { CropRegion, CursorTelemetryPoint, ZoomFocus, ZoomRegion } from "../types";
import { ZOOM_DEPTH_SCALES } from "../types";
import { DEFAULT_FOCUS } from "./constants";
import {
	type CursorFollowCameraState,
	computeCursorFollowFocus,
	createCursorFollowCameraState,
	resetCursorFollowCamera,
	SNAP_TO_EDGES_RATIO_AUTO,
} from "./cursorFollowCamera";
import { findDominantRegion } from "./zoomRegionUtils";

export type SceneZoomTarget = {
	scale: number;
	focus: ZoomFocus;
	progress: number;
	connected?: boolean;
	cinematic?: boolean;
};

export type PreviewMotionMode = "spring" | "snap" | "preserve";

const connectedCameras = new WeakMap<
	CursorFollowCameraState,
	{
		key: string;
		startFocus: ZoomFocus;
		endCamera: CursorFollowCameraState;
	}
>();

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
	hasPendingNeutralFrame = false,
}: {
	motionMode: PreviewMotionMode;
	isSeeking?: boolean;
	contentTimeChanged: boolean;
	shouldSnapPausedFrame: boolean;
	hasPendingNeutralFrame?: boolean;
}): boolean {
	// Do not consume the pending composition against the old decoded image.
	if (isSeeking || (motionMode === "preserve" && !hasPendingNeutralFrame)) {
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
	connectedZoomGapMs,
	connectedZoomDurationMs,
	zoomClassicMode,
	cursorTelemetry,
	cursorFollowCamera,
	sourceCrop,
}: {
	zoomRegions: ZoomRegion[];
	timeMs: number;
	cursorTimeMs?: number;
	connectZooms?: boolean;
	zoomInDurationMs?: number;
	zoomOutDurationMs?: number;
	connectedZoomGapMs?: number;
	connectedZoomDurationMs?: number;
	zoomClassicMode?: boolean;
	cursorTelemetry?: CursorTelemetryPoint[];
	cursorFollowCamera: CursorFollowCameraState;
	sourceCrop?: CropRegion;
}): SceneZoomTarget {
	const weight = isCinematicZoomMotion({ zoomInDurationMs, zoomOutDurationMs })
		? { cinematic: true }
		: {};
	const { region, strength, zoomingOut, blendedScale, transition, completedTransition } =
		findDominantRegion(zoomRegions, timeMs, {
			connectZooms,
			zoomInDurationMs,
			zoomOutDurationMs,
			connectedZoomGapMs,
			connectedZoomDurationMs,
			sourceCrop,
		});

	if (!region || strength <= 0) {
		// A later zoom-in must not inherit the previous zoom-out's frozen focus.
		resetCursorFollowCamera(cursorFollowCamera);
		connectedCameras.delete(cursorFollowCamera);
		return { scale: 1, focus: DEFAULT_FOCUS, progress: 0 };
	}

	const scale = blendedScale ?? ZOOM_DEPTH_SCALES[region.depth];
	if (transition) {
		let camera = connectedCameras.get(cursorFollowCamera);
		if (camera?.key !== transition.key) {
			if (camera) Object.assign(cursorFollowCamera, camera.endCamera);
			camera = {
				key: transition.key,
				startFocus: cursorFollowCamera.initialized
					? { cx: cursorFollowCamera.focusX, cy: cursorFollowCamera.focusY }
					: transition.startFocus,
				endCamera: createCursorFollowCameraState(),
			};
			connectedCameras.set(cursorFollowCamera, camera);
		}
		const endFocus =
			!zoomClassicMode && region.mode !== "manual" && cursorTelemetry?.length
				? computeCursorFollowFocus(
						camera.endCamera,
						cursorTelemetry,
						cursorTimeMs,
						transition.endScale,
						strength,
						transition.endFocus,
						{ snapToEdgesRatio: SNAP_TO_EDGES_RATIO_AUTO, sourceCrop, zoomingOut },
					)
				: transition.endFocus;
		return {
			...weight,
			scale,
			focus: {
				cx:
					camera.startFocus.cx +
					(endFocus.cx - camera.startFocus.cx) * transition.progress,
				cy:
					camera.startFocus.cy +
					(endFocus.cy - camera.startFocus.cy) * transition.progress,
			},
			progress: strength,
			connected: true,
		};
	}
	const pendingCamera = connectedCameras.get(cursorFollowCamera);
	const connectedCamera =
		pendingCamera?.key === completedTransition?.key ? pendingCamera : undefined;
	if (pendingCamera && !connectedCamera) {
		connectedCameras.delete(cursorFollowCamera);
		resetCursorFollowCamera(cursorFollowCamera);
	}
	if (completedTransition && timeMs < region.startMs) {
		// Hold the spring goal until the incoming block starts; physical settling continues.
		const focus = connectedCamera?.endCamera.initialized
			? { cx: connectedCamera.endCamera.focusX, cy: connectedCamera.endCamera.focusY }
			: region.focus;
		return {
			...weight,
			scale,
			focus,
			progress: strength,
			connected: true,
		};
	}
	if (connectedCamera) {
		Object.assign(cursorFollowCamera, connectedCamera.endCamera);
		connectedCameras.delete(cursorFollowCamera);
	}
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
			{ snapToEdgesRatio: SNAP_TO_EDGES_RATIO_AUTO, sourceCrop, zoomingOut },
		);
	} else {
		// Manual/classic framing owns the camera until automatic follow resumes.
		resetCursorFollowCamera(cursorFollowCamera);
	}

	return {
		...weight,
		scale,
		focus,
		progress: strength,
		connected: Boolean(completedTransition),
	};
}
