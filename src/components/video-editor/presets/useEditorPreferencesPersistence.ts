import { type MutableRefObject, useEffect, useRef } from "react";
import type { AspectRatio } from "@/utils/aspectRatioUtils";
import { desktopWallpaperPreference } from "@/lib/desktopWallpaper";
import {
	type EditorPreferences,
	type EditorPreferencesPatch,
	saveEditorPreferences,
} from "../editorPreferences";
import type { useAppearanceState } from "../state/useAppearanceState";

type Input = {
	enabled: boolean;
	restoringPreferencesRef: MutableRefObject<boolean>;
	appearance: ReturnType<typeof useAppearanceState>;
	aspectRatio: AspectRatio;
	whisperExecutablePath: string | null;
	whisperModelPath: string | null;
};

export function useEditorPreferencesPersistence({
	enabled,
	restoringPreferencesRef,
	appearance,
	aspectRatio,
	whisperExecutablePath,
	whisperModelPath,
}: Input) {
	const previousRef = useRef<Partial<EditorPreferences> | null>(null);
	useEffect(() => {
		const current = {
			autoApplyFreshRecordingAutoZooms: appearance.autoApplyFreshRecordingAutoZooms,
			wallpaper: desktopWallpaperPreference(appearance.wallpaper),
			shadowIntensity: appearance.shadowIntensity,
			backgroundBlur: appearance.backgroundBlur,
			zoomMotionBlur: appearance.zoomMotionBlur,
			zoomMotionBlurTuning: appearance.zoomMotionBlurTuning,
			connectZooms: appearance.connectZooms,
			zoomInDurationMs: appearance.zoomInDurationMs,
			zoomInOverlapMs: appearance.zoomInOverlapMs,
			zoomOutDurationMs: appearance.zoomOutDurationMs,
			connectedZoomGapMs: appearance.connectedZoomGapMs,
			connectedZoomDurationMs: appearance.connectedZoomDurationMs,
			zoomInEasing: appearance.zoomInEasing,
			zoomOutEasing: appearance.zoomOutEasing,
			connectedZoomEasing: appearance.connectedZoomEasing,
			showCursor: appearance.showCursor,
			loopCursor: appearance.loopCursor,
			cursorStyle: appearance.cursorStyle,
			cursorSize: appearance.cursorSize,
			cursorSmoothing: appearance.cursorSmoothing,
			cursorSpringStiffnessMultiplier: appearance.cursorSpringStiffnessMultiplier,
			cursorSpringDampingMultiplier: appearance.cursorSpringDampingMultiplier,
			cursorSpringMassMultiplier: appearance.cursorSpringMassMultiplier,
			cameraSpringStiffnessMultiplier: appearance.cameraSpringStiffnessMultiplier,
			cameraSpringDampingMultiplier: appearance.cameraSpringDampingMultiplier,
			cameraSpringMassMultiplier: appearance.cameraSpringMassMultiplier,
			cursorMotionBlur: appearance.cursorMotionBlur,
			cursorClickEffect: appearance.cursorClickEffect,
			cursorClickEffectColor: appearance.cursorClickEffectColor,
			cursorClickEffectScale: appearance.cursorClickEffectScale,
			cursorClickEffectOpacity: appearance.cursorClickEffectOpacity,
			cursorClickEffectDurationMs: appearance.cursorClickEffectDurationMs,
			cursorClickBounce: appearance.cursorClickBounce,
			cursorClickBounceDuration: appearance.cursorClickBounceDuration,
			cursorSway: appearance.cursorSway,
			cursorIdleHide: appearance.cursorIdleHide,
			borderRadius: appearance.borderRadius,
			padding: appearance.padding,
			webcam: appearance.webcam,
			aspectRatio,
			whisperExecutablePath,
			whisperModelPath,
		};
		const previous = previousRef.current;
		previousRef.current = current;
		const restoring = restoringPreferencesRef.current;
		restoringPreferencesRef.current = false;
		if (!enabled || !previous || restoring) return;

		// Save only changed controls. Another editor or a restored project can have
		// different values for the rest of the controls, including webcam shadow.
		const changes: EditorPreferencesPatch = {};
		for (const key of Object.keys(current) as (keyof typeof current)[]) {
			if (key === "webcam") {
				const webcam = Object.fromEntries(
					Object.entries(current.webcam).filter(
						([field, value]) =>
							JSON.stringify(value) !==
							JSON.stringify(
								previous.webcam?.[field as keyof EditorPreferences["webcam"]],
							),
					),
				);
				if (Object.keys(webcam).length) changes.webcam = webcam;
			} else if (JSON.stringify(current[key]) !== JSON.stringify(previous[key])) {
				Object.assign(changes, { [key]: current[key] });
			}
		}
		if (Object.keys(changes).length) saveEditorPreferences(changes);
	}, [
		enabled,
		restoringPreferencesRef,
		appearance.wallpaper,
		appearance.shadowIntensity,
		appearance.backgroundBlur,
		appearance.zoomMotionBlur,
		appearance.zoomMotionBlurTuning,
		appearance.connectZooms,
		appearance.autoApplyFreshRecordingAutoZooms,
		appearance.zoomInDurationMs,
		appearance.zoomInOverlapMs,
		appearance.zoomOutDurationMs,
		appearance.connectedZoomGapMs,
		appearance.connectedZoomDurationMs,
		appearance.zoomInEasing,
		appearance.zoomOutEasing,
		appearance.connectedZoomEasing,
		appearance.showCursor,
		appearance.loopCursor,
		appearance.cursorStyle,
		appearance.cursorSize,
		appearance.cursorSmoothing,
		appearance.cursorSpringStiffnessMultiplier,
		appearance.cursorSpringDampingMultiplier,
		appearance.cursorSpringMassMultiplier,
		appearance.cameraSpringStiffnessMultiplier,
		appearance.cameraSpringDampingMultiplier,
		appearance.cameraSpringMassMultiplier,
		appearance.cursorMotionBlur,
		appearance.cursorClickEffect,
		appearance.cursorClickEffectColor,
		appearance.cursorClickEffectScale,
		appearance.cursorClickEffectOpacity,
		appearance.cursorClickEffectDurationMs,
		appearance.cursorClickBounce,
		appearance.cursorClickBounceDuration,
		appearance.cursorSway,
		appearance.cursorIdleHide,
		appearance.borderRadius,
		appearance.padding,
		appearance.webcam,
		aspectRatio,
		whisperExecutablePath,
		whisperModelPath,
	]);
}
