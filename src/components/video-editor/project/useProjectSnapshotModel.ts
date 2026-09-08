import { type RefObject, useCallback, useEffect, useMemo } from "react";
import type { AspectRatio } from "@/utils/aspectRatioUtils";
import type { useExportSettings } from "../export/useExportSettings";
import {
	fromFileUrl,
	type ProjectEditorState,
	stripPersistedDevMotionBlurSettings,
} from "../projectPersistence";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useProjectState } from "../state/useProjectState";
import type { useTimelineState } from "../state/useTimelineState";

type Input = {
	t: (key: string, fallback?: string) => string;
	project: ReturnType<typeof useProjectState>;
	appearance: ReturnType<typeof useAppearanceState>;
	timeline: ReturnType<typeof useTimelineState>;
	exportSettings: ReturnType<typeof useExportSettings>;
	aspectRatio: AspectRatio;
	projectNameInputRef: RefObject<HTMLInputElement | null>;
	projectSaveDialogInputRef: RefObject<HTMLInputElement | null>;
};

export function useProjectSnapshotModel({
	t,
	project,
	appearance,
	timeline,
	exportSettings,
	aspectRatio,
	projectNameInputRef,
	projectSaveDialogInputRef,
}: Input) {
	const buildPersistedEditorState = useCallback(
		(editor: Partial<ProjectEditorState>) => stripPersistedDevMotionBlurSettings(editor),
		[],
	);
	const currentSourcePath = useMemo(
		() =>
			project.videoSourcePath ?? (project.videoPath ? fromFileUrl(project.videoPath) : null),
		[project.videoPath, project.videoSourcePath],
	);
	const projectDisplayName = useMemo(() => {
		const fileName =
			project.currentProjectPath?.split(/[\\/]/).pop() ??
			currentSourcePath?.split(/[\\/]/).pop() ??
			"";
		return (
			fileName.replace(/\.recordly$/i, "").replace(/\.[^.]+$/, "") ||
			t("editor.project.untitled", "Untitled")
		);
	}, [project.currentProjectPath, currentSourcePath, t]);

	useEffect(() => {
		if (!project.isEditingProjectName) project.setProjectNameDraft(projectDisplayName);
	}, [project.isEditingProjectName, project.setProjectNameDraft, projectDisplayName]);
	useEffect(() => {
		if (!project.isEditingProjectName) return;
		const frameId = window.requestAnimationFrame(() => {
			projectNameInputRef.current?.focus();
			projectNameInputRef.current?.select();
		});
		return () => window.cancelAnimationFrame(frameId);
	}, [project.isEditingProjectName, projectNameInputRef]);
	useEffect(() => {
		if (!project.projectSaveDialogOpen) return;
		const frameId = window.requestAnimationFrame(() => {
			projectSaveDialogInputRef.current?.focus();
			projectSaveDialogInputRef.current?.select();
		});
		return () => window.cancelAnimationFrame(frameId);
	}, [project.projectSaveDialogOpen, projectSaveDialogInputRef]);

	const currentPersistedEditorState = useMemo(
		() =>
			buildPersistedEditorState({
				wallpaper: appearance.wallpaper,
				shadowIntensity: appearance.shadowIntensity,
				backgroundBlur: appearance.backgroundBlur,
				zoomMotionBlur: appearance.zoomMotionBlur,
				zoomMotionBlurTuning: appearance.zoomMotionBlurTuning,
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
				zoomSmoothness: appearance.zoomSmoothness,
				zoomClassicMode: appearance.zoomClassicMode,
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
				padding: appearance.padding,
				cropRegion: appearance.cropRegion,
				webcam: appearance.webcam,
				zoomRegions: timeline.zoomRegions,
				trimRegions: timeline.trimRegions,
				clipRegions: timeline.clipRegions,
				speedRegions: timeline.speedRegions,
				annotationRegions: timeline.annotationRegions,
				audioRegions: timeline.audioRegions,
				autoCaptions: timeline.autoCaptions,
				autoCaptionSettings: timeline.autoCaptionSettings,
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
				sourceAudioTrackSettingsByClip: timeline.sourceAudioTrackSettingsByClip,
				defaultSourceAudioTrackSettings: timeline.defaultSourceAudioTrackSettings,
			}),
		[
			appearance.wallpaper,
			appearance.shadowIntensity,
			appearance.backgroundBlur,
			appearance.zoomMotionBlur,
			appearance.zoomMotionBlurTuning,
			appearance.zoomTemporalMotionBlur,
			appearance.zoomMotionBlurSampleCount,
			appearance.zoomMotionBlurShutterFraction,
			appearance.connectZooms,
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
			appearance.zoomSmoothness,
			appearance.zoomClassicMode,
			appearance.cursorMotionBlur,
			appearance.cursorClickEffect,
			appearance.cursorClickEffectColor,
			appearance.cursorClickEffectScale,
			appearance.cursorClickEffectOpacity,
			appearance.cursorClickEffectDurationMs,
			appearance.cursorClickBounce,
			appearance.cursorClickBounceDuration,
			appearance.cursorSway,
			appearance.deviceFrame,
			appearance.borderRadius,
			appearance.padding,
			appearance.cropRegion,
			appearance.webcam,
			timeline.zoomRegions,
			timeline.trimRegions,
			timeline.clipRegions,
			timeline.speedRegions,
			timeline.annotationRegions,
			timeline.audioRegions,
			timeline.autoCaptions,
			timeline.autoCaptionSettings,
			aspectRatio,
			exportSettings.exportEncodingMode,
			exportSettings.exportBackendPreference,
			exportSettings.exportPipelineModel,
			exportSettings.exportQuality,
			exportSettings.mp4FrameRate,
			exportSettings.exportFormat,
			exportSettings.gifFrameRate,
			exportSettings.gifLoop,
			exportSettings.gifSizePreset,
			timeline.sourceAudioTrackSettingsByClip,
			timeline.defaultSourceAudioTrackSettings,
			buildPersistedEditorState,
		],
	);

	return {
		buildPersistedEditorState,
		currentSourcePath,
		projectDisplayName,
		currentPersistedEditorState,
	};
}
