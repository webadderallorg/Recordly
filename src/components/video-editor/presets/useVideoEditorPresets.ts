import { type Dispatch, type SetStateAction, useCallback, useMemo, useState } from "react";
import type { AspectRatio } from "@/utils/aspectRatioUtils";
import { type EditorPresetSnapshot, loadEditorPresets } from "../editorPreferences";
import type { useExportSettings } from "../export/useExportSettings";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useTimelineState } from "../state/useTimelineState";
import { useEditorPresets } from "./useEditorPresets";

type Input = {
	t: Parameters<typeof useEditorPresets>[0]["t"];
	appearance: ReturnType<typeof useAppearanceState>;
	timeline: ReturnType<typeof useTimelineState>;
	exportSettings: ReturnType<typeof useExportSettings>;
	aspectRatio: AspectRatio;
	setAspectRatio: Dispatch<SetStateAction<AspectRatio>>;
	whisperExecutablePath: string | null;
	setWhisperExecutablePath: Dispatch<SetStateAction<string | null>>;
	whisperModelPath: string | null;
	setWhisperModelPath: Dispatch<SetStateAction<string | null>>;
};

export function useVideoEditorPresets({
	t,
	appearance,
	timeline,
	exportSettings,
	aspectRatio,
	setAspectRatio,
	whisperExecutablePath,
	setWhisperExecutablePath,
	whisperModelPath,
	setWhisperModelPath,
}: Input) {
	const [editorPresets, setEditorPresets] = useState(() => loadEditorPresets());
	const [activeEditorPresetId, setActiveEditorPresetId] = useState<string | null>(null);
	const [presetPopoverOpen, setPresetPopoverOpen] = useState(false);
	const [presetNameDraft, setPresetNameDraft] = useState("");

	const currentSnapshot = useMemo<EditorPresetSnapshot>(
		() => ({
			wallpaper: appearance.wallpaper,
			shadowIntensity: appearance.shadowIntensity,
			backgroundBlur: appearance.backgroundBlur,
			zoomMotionBlur: appearance.zoomMotionBlur,
			zoomMotionBlurTuning: { ...appearance.zoomMotionBlurTuning },
			zoomTemporalMotionBlur: appearance.zoomTemporalMotionBlur,
			zoomMotionBlurSampleCount: appearance.zoomMotionBlurSampleCount,
			zoomMotionBlurShutterFraction: appearance.zoomMotionBlurShutterFraction,
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
			deviceFrame: appearance.deviceFrame,
			borderRadius: appearance.borderRadius,
			borderRadiusUnit: "percent",
			padding: { ...appearance.padding },
			cropRegion: { ...appearance.cropRegion },
			webcam: (({ sourcePath: _sourcePath, ...settings }) => settings)(appearance.webcam),
			aspectRatio,
			exportEncodingMode: exportSettings.exportEncodingMode,
			exportBackendPreference: exportSettings.exportBackendPreference,
			exportPipelineModel: exportSettings.exportPipelineModel,
			exportQuality: exportSettings.exportQuality,
			mp4FrameRate: exportSettings.mp4FrameRate,
			exportFormat: exportSettings.exportFormat,
			gifFrameRate: exportSettings.gifFrameRate,
			gifLoop: exportSettings.gifLoop,
			gifSizePreset: exportSettings.gifSizePreset,
			autoCaptionSettings: { ...timeline.autoCaptionSettings },
			whisperExecutablePath,
			whisperModelPath,
		}),
		[
			appearance,
			timeline.autoCaptionSettings,
			exportSettings,
			aspectRatio,
			whisperExecutablePath,
			whisperModelPath,
		],
	);

	const applySnapshot = useCallback(
		(snapshot: EditorPresetSnapshot) => {
			appearance.setWallpaper(snapshot.wallpaper);
			appearance.setShadowIntensity(snapshot.shadowIntensity);
			appearance.setBackgroundBlur(snapshot.backgroundBlur);
			appearance.setZoomMotionBlur(snapshot.zoomMotionBlur);
			appearance.setZoomMotionBlurTuning({ ...snapshot.zoomMotionBlurTuning });
			appearance.setZoomTemporalMotionBlur(snapshot.zoomTemporalMotionBlur);
			appearance.setZoomMotionBlurSampleCount(snapshot.zoomMotionBlurSampleCount);
			appearance.setZoomMotionBlurShutterFraction(snapshot.zoomMotionBlurShutterFraction);
			appearance.setConnectZooms(snapshot.connectZooms);
			appearance.setZoomInDurationMs(snapshot.zoomInDurationMs);
			appearance.setZoomInOverlapMs(snapshot.zoomInOverlapMs);
			appearance.setZoomOutDurationMs(snapshot.zoomOutDurationMs);
			appearance.setConnectedZoomGapMs(snapshot.connectedZoomGapMs);
			appearance.setConnectedZoomDurationMs(snapshot.connectedZoomDurationMs);
			appearance.setZoomInEasing(snapshot.zoomInEasing);
			appearance.setZoomOutEasing(snapshot.zoomOutEasing);
			appearance.setConnectedZoomEasing(snapshot.connectedZoomEasing);
			appearance.setShowCursor(snapshot.showCursor);
			appearance.setLoopCursor(snapshot.loopCursor);
			appearance.setCursorStyle(snapshot.cursorStyle);
			appearance.setCursorSize(snapshot.cursorSize);
			appearance.setCursorSmoothing(snapshot.cursorSmoothing);
			appearance.setCursorSpringStiffnessMultiplier(snapshot.cursorSpringStiffnessMultiplier);
			appearance.setCursorSpringDampingMultiplier(snapshot.cursorSpringDampingMultiplier);
			appearance.setCursorSpringMassMultiplier(snapshot.cursorSpringMassMultiplier);
			appearance.setCameraSpringStiffnessMultiplier(snapshot.cameraSpringStiffnessMultiplier);
			appearance.setCameraSpringDampingMultiplier(snapshot.cameraSpringDampingMultiplier);
			appearance.setCameraSpringMassMultiplier(snapshot.cameraSpringMassMultiplier);
			appearance.setCursorMotionBlur(snapshot.cursorMotionBlur);
			appearance.setCursorClickEffect(snapshot.cursorClickEffect);
			appearance.setCursorClickEffectColor(snapshot.cursorClickEffectColor);
			appearance.setCursorClickEffectScale(snapshot.cursorClickEffectScale);
			appearance.setCursorClickEffectOpacity(snapshot.cursorClickEffectOpacity);
			appearance.setCursorClickEffectDurationMs(snapshot.cursorClickEffectDurationMs);
			appearance.setCursorClickBounce(snapshot.cursorClickBounce);
			appearance.setCursorClickBounceDuration(snapshot.cursorClickBounceDuration);
			appearance.setCursorSway(snapshot.cursorSway);
			appearance.setDeviceFrame(snapshot.deviceFrame);
			appearance.setBorderRadius(snapshot.borderRadius);
			appearance.setPadding({ ...snapshot.padding });
			appearance.setCropRegion({ ...snapshot.cropRegion });
			appearance.setWebcam((current) => ({
				...snapshot.webcam,
				sourcePath: current.sourcePath,
			}));
			setAspectRatio(snapshot.aspectRatio);
			exportSettings.setExportEncodingMode(snapshot.exportEncodingMode);
			exportSettings.setExportBackendPreference(snapshot.exportBackendPreference);
			exportSettings.setExportPipelineModel(snapshot.exportPipelineModel);
			exportSettings.setExportQuality(snapshot.exportQuality);
			exportSettings.setMp4FrameRate(snapshot.mp4FrameRate);
			exportSettings.setExportFormat(snapshot.exportFormat);
			exportSettings.setGifFrameRate(snapshot.gifFrameRate);
			exportSettings.setGifLoop(snapshot.gifLoop);
			exportSettings.setGifSizePreset(snapshot.gifSizePreset);
			timeline.setAutoCaptionSettings({ ...snapshot.autoCaptionSettings });
			setWhisperExecutablePath(snapshot.whisperExecutablePath);
			setWhisperModelPath(snapshot.whisperModelPath);
		},
		[
			appearance,
			exportSettings,
			timeline,
			setAspectRatio,
			setWhisperExecutablePath,
			setWhisperModelPath,
		],
	);

	const actions = useEditorPresets({
		t,
		currentSnapshot,
		applySnapshot,
		editorPresets,
		setEditorPresets,
		activePresetId: activeEditorPresetId,
		setActivePresetId: setActiveEditorPresetId,
		presetPopoverOpen,
		presetNameDraft,
		setPresetNameDraft,
	});
	return {
		editorPresets,
		activeEditorPresetId,
		presetPopoverOpen,
		setPresetPopoverOpen,
		presetNameDraft,
		setPresetNameDraft,
		...actions,
	};
}
