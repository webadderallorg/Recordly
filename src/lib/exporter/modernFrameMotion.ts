import { computeCameraTransform } from "@/components/video-editor/videoPlayback/cameraTransform";
import {
	type CursorFollowCameraState,
	createCursorFollowCameraState,
} from "@/components/video-editor/videoPlayback/cursorFollowCamera";
import {
	createSpringState,
	type SpringState,
} from "@/components/video-editor/videoPlayback/motionSmoothing";
import { resolveSceneZoomTarget } from "@/components/video-editor/videoPlayback/sceneMotion";
import {
	createMotionBlurState,
	type MotionBlurState,
} from "@/components/video-editor/videoPlayback/zoomTransform";
import type { FrameRenderContext } from "./modernFrameRenderer";
import type { AnimationState } from "./modernFrameTypes";
import { createAnimationState } from "./modernFrameUtils";

/** Owns motion resources for one export renderer. */
export class FrameMotion {
	constructor(
		private readonly context: Pick<FrameRenderContext, "scene" | "geometry" | "config">,
	) {}

	animationState: AnimationState = createAnimationState();

	motionBlurState: MotionBlurState = createMotionBlurState();

	springScale: SpringState = createSpringState(1);

	springX: SpringState = createSpringState(0);

	springY: SpringState = createSpringState(0);

	cursorFollowCamera: CursorFollowCameraState = createCursorFollowCameraState();

	lastContentTimeMs: number | null = null;

	updateAnimationState(timeMs: number, cursorTimeMs = timeMs): number {
		if (!this.context.scene.cameraContainer || !this.context.geometry.layoutCache) {
			return 0;
		}

		const target = resolveSceneZoomTarget({
			zoomRegions: this.context.config.zoomRegions,
			timeMs,
			cursorTimeMs,
			connectZooms: this.context.config.connectZooms,
			zoomInDurationMs: this.context.config.zoomInDurationMs,
			zoomOutDurationMs: this.context.config.zoomOutDurationMs,
			connectedZoomGapMs: this.context.config.connectedZoomGapMs,
			connectedZoomDurationMs: this.context.config.connectedZoomDurationMs,
			zoomClassicMode: this.context.config.zoomClassicMode,
			cursorTelemetry: this.context.config.cursorTelemetry,
			cursorFollowCamera: this.cursorFollowCamera,
			sourceCrop: this.context.config.cropRegion,
		});

		const state = this.animationState;
		const previousScale = state.appliedScale;
		const previousX = state.x;
		const previousY = state.y;

		state.scale = target.scale;
		state.focusX = target.focus.cx;
		state.focusY = target.focus.cy;
		state.progress = target.progress;

		const deltaMs =
			this.lastContentTimeMs !== null ? timeMs - this.lastContentTimeMs : 1000 / 60;
		this.lastContentTimeMs = timeMs;
		const transform = computeCameraTransform({
			target,
			stageSize: this.context.geometry.layoutCache.stageSize,
			baseMask: this.context.geometry.layoutCache.maskRect,
			springScale: this.springScale,
			springX: this.springX,
			springY: this.springY,
			deltaMs,
			snap: this.context.config.zoomClassicMode,
			zoomSmoothness: this.context.config.zoomSmoothness,
			tuning: {
				stiffnessMultiplier: this.context.config.cameraSpringStiffnessMultiplier,
				dampingMultiplier: this.context.config.cameraSpringDampingMultiplier,
				massMultiplier: this.context.config.cameraSpringMassMultiplier,
			},
		});
		state.appliedScale = transform.scale;
		state.x = transform.x;
		state.y = transform.y;

		return Math.max(
			Math.abs(state.appliedScale - previousScale),
			Math.abs(state.x - previousX) /
				Math.max(1, this.context.geometry.layoutCache.stageSize.width),
			Math.abs(state.y - previousY) /
				Math.max(1, this.context.geometry.layoutCache.stageSize.height),
		);
	}
}
