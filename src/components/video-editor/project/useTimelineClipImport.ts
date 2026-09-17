import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import { useCallback, useRef } from "react";
import { toast } from "sonner";
import { buildImportedClipPlan } from "../importedClipPlan";
import { fromFileUrl, resolveVideoUrl } from "../projectPersistence";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useProjectState } from "../state/useProjectState";
import type { useTimelineState } from "../state/useTimelineState";
import type { VideoPlaybackRef } from "../VideoPlayback";

type Input = {
	project: ReturnType<typeof useProjectState>;
	appearance: ReturnType<typeof useAppearanceState>;
	timeline: ReturnType<typeof useTimelineState>;
	videoPlaybackRef: RefObject<VideoPlaybackRef>;
	nextClipIdRef: MutableRefObject<number>;
	autoFullTrackClipIdRef: MutableRefObject<string | null>;
	autoFullTrackClipEndMsRef: MutableRefObject<number | null>;
	setIsPlaying: Dispatch<SetStateAction<boolean>>;
	setCurrentTime: Dispatch<SetStateAction<number>>;
	setDuration: Dispatch<SetStateAction<number>>;
	setIsPreviewReady: Dispatch<SetStateAction<boolean>>;
	remountPreview: () => void;
};

export function useTimelineClipImport(input: Input) {
	const inputRef = useRef(input);
	inputRef.current = input;
	const importingRef = useRef(false);

	return useCallback(async () => {
		if (importingRef.current) {
			toast.info("A clip is already being imported.");
			return;
		}

		const current = inputRef.current;
		const sourcePath = current.project.videoSourcePath;
		const projectPath = current.project.currentProjectPath;
		if (!sourcePath) {
			toast.error("Open a recording before importing a clip.");
			return;
		}

		const selection = await window.electronAPI.openVideoFilePicker({
			preserveProjectPath: true,
		});
		if (selection.canceled) return;
		if (!selection.success || !selection.path) {
			toast.error(selection.message || "Unable to select the clip.");
			return;
		}

		const clipPath = fromFileUrl(selection.path);
		importingRef.current = true;
		const toastId = toast.loading(
			"Preparing clip… Your original recording will not be modified.",
		);
		try {
			const result = await window.electronAPI.importTimelineClip({
				sourcePath,
				clipPath,
			});
			if (
				!result.success ||
				!result.outputPath ||
				!result.sourceDurationMs ||
				!result.importedDurationMs
			) {
				throw new Error(result.message || "Unable to import clip.");
			}

			const latest = inputRef.current;
			if (
				latest.project.videoSourcePath !== sourcePath ||
				latest.project.currentProjectPath !== projectPath
			) {
				throw new Error(
					"The active project changed while the clip was importing. No editor changes were made.",
				);
			}

			const plan = buildImportedClipPlan({
				clips: latest.timeline.clipRegions,
				sourceDurationMs: result.sourceDurationMs,
				importedDurationMs: result.importedDurationMs,
				nextClipId: latest.nextClipIdRef.current,
			});
			const outputPath = result.outputPath;
			const outputUrl = await resolveVideoUrl(outputPath);

			try {
				latest.videoPlaybackRef.current?.pause();
			} catch {
				// The preview may already be remounting.
			}
			const preserveProjectPath = Boolean(latest.project.currentProjectPath);
			if (latest.appearance.webcam.sourcePath) {
				await window.electronAPI.setCurrentRecordingSession(
					{
						videoPath: outputPath,
						webcamPath: latest.appearance.webcam.sourcePath,
						timeOffsetMs: latest.appearance.webcam.timeOffsetMs,
					},
					{ preserveProjectPath },
				);
			} else {
				await window.electronAPI.setCurrentVideoPath(outputPath, { preserveProjectPath });
			}

			latest.autoFullTrackClipIdRef.current = null;
			latest.autoFullTrackClipEndMsRef.current = null;
			latest.nextClipIdRef.current += 1;
			latest.timeline.setClipRegions((clips) => [...clips, plan.clip]);
			latest.timeline.setSelectedClipId(plan.clip.id);
			latest.timeline.setSelectedZoomId(null);
			latest.timeline.setSelectedAnnotationId(null);
			latest.timeline.setSelectedAudioId(null);
			latest.timeline.setSelectedCaptionId(null);
			latest.timeline.setSourceAudioTrackSettingsByClip({});
			latest.timeline.setDefaultSourceAudioTrackSettings({});
			latest.timeline.setSourceAudioFallbackRefreshKey((value) => value + 1);
			latest.project.setVideoSourcePath(outputPath);
			latest.project.setVideoPath(outputUrl);
			latest.setIsPlaying(false);
			latest.setDuration(0);
			latest.setCurrentTime(plan.timelineStartMs / 1000);
			latest.setIsPreviewReady(false);
			latest.remountPreview();
			toast.success(
				"Clip imported at the end of the timeline. Save the project to keep it.",
				{
					id: toastId,
				},
			);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Unable to import clip.", {
				id: toastId,
				duration: 10_000,
			});
		} finally {
			importingRef.current = false;
		}
	}, []);
}
