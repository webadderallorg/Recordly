import { useEffect } from "react";
import { DEFAULT_CURSOR_CONFIG, preloadCursorAssets } from "./cursorRenderer";
import type { PlaybackProps } from "./playbackProps";
import type { usePlaybackState } from "./usePlaybackState";
export type usePlaybackCursorSettingsInput = Pick<
	ReturnType<typeof usePlaybackState> & PlaybackProps,
	| "cursorOverlayRef"
	| "pixiReady"
	| "cursorSize"
	| "cursorSmoothing"
	| "cursorSpringStiffnessMultiplier"
	| "cursorSpringDampingMultiplier"
	| "cursorSpringMassMultiplier"
	| "cursorMotionBlur"
	| "cursorClickEffect"
	| "cursorClickEffectColor"
	| "cursorClickEffectScale"
	| "cursorClickEffectOpacity"
	| "cursorClickEffectDurationMs"
	| "cursorClickBounce"
	| "cursorClickBounceDuration"
	| "cursorSway"
	| "cursorIdleHide"
	| "cursorStyle"
	| "requestPausedFrameRefresh"
>;
export function usePlaybackCursorSettings(input: usePlaybackCursorSettingsInput) {
	const {
		cursorOverlayRef,
		pixiReady,
		cursorSize,
		cursorSmoothing,
		cursorSpringStiffnessMultiplier,
		cursorSpringDampingMultiplier,
		cursorSpringMassMultiplier,
		cursorMotionBlur,
		cursorClickEffect,
		cursorClickEffectColor,
		cursorClickEffectScale,
		cursorClickEffectOpacity,
		cursorClickEffectDurationMs,
		cursorClickBounce,
		cursorClickBounceDuration,
		cursorSway,
		cursorIdleHide,
		cursorStyle,
		requestPausedFrameRefresh,
	} = input;

	useEffect(() => {
		const overlay = cursorOverlayRef.current;
		if (!pixiReady || !overlay) {
			return;
		}

		overlay.setDotRadius(DEFAULT_CURSOR_CONFIG.dotRadius * cursorSize);
		overlay.setSmoothingFactor(cursorSmoothing);
		overlay.setSpringTuning({
			stiffnessMultiplier: cursorSpringStiffnessMultiplier,
			dampingMultiplier: cursorSpringDampingMultiplier,
			massMultiplier: cursorSpringMassMultiplier,
		});
		overlay.setMotionBlur(cursorMotionBlur);
		overlay.setClickEffect(cursorClickEffect);
		overlay.setClickEffectColor(cursorClickEffectColor);
		overlay.setClickEffectScale(cursorClickEffectScale);
		overlay.setClickEffectOpacity(cursorClickEffectOpacity);
		overlay.setClickEffectDurationMs(cursorClickEffectDurationMs);
		overlay.setClickBounce(cursorClickBounce);
		overlay.setClickBounceDuration(cursorClickBounceDuration);
		overlay.setSway(cursorSway);
		overlay.setIdleHideSettings({
			enabled: cursorIdleHide.enabled,
			idleThresholdMs: cursorIdleHide.idleThresholdMs,
			fadeDelayMs: cursorIdleHide.fadeDelayMs,
			fadeDurationMs: cursorIdleHide.fadeDurationMs,
			movementTolerancePx: cursorIdleHide.movementTolerancePx,
		});
		requestPausedFrameRefresh();
	}, [
		pixiReady,
		requestPausedFrameRefresh,
		cursorOverlayRef,
		cursorSize,
		cursorSmoothing,
		cursorSpringStiffnessMultiplier,
		cursorSpringDampingMultiplier,
		cursorSpringMassMultiplier,
		cursorMotionBlur,
		cursorClickEffect,
		cursorClickEffectColor,
		cursorClickEffectScale,
		cursorClickEffectOpacity,
		cursorClickEffectDurationMs,
		cursorClickBounce,
		cursorClickBounceDuration,
		cursorSway,
		cursorIdleHide.enabled,
		cursorIdleHide.idleThresholdMs,
		cursorIdleHide.fadeDelayMs,
		cursorIdleHide.fadeDurationMs,
		cursorIdleHide.movementTolerancePx,
	]);

	useEffect(() => {
		const overlay = cursorOverlayRef.current;
		if (!pixiReady || !overlay) return;
		let cancelled = false;
		void (async () => {
			try {
				await preloadCursorAssets();
			} catch (error) {
				console.warn("Failed to refresh cursor assets for preview:", error);
				return;
			}

			if (cancelled || cursorOverlayRef.current !== overlay) {
				return;
			}

			overlay.setStyle(cursorStyle);
			overlay.reset();
			requestPausedFrameRefresh();
		})();

		return () => {
			cancelled = true;
		};
	}, [pixiReady, requestPausedFrameRefresh, cursorStyle, cursorOverlayRef]);
	return {};
}
