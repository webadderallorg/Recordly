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

			const plan = buildImportedClipPlan({
				clips: current.timeline.clipRegions,
				sourceDurationMs: result.sourceDurationMs,
				importedDurationMs: result.importedDurationMs,
				nextClipId: current.nextClipIdRef.current,
			});
			const outputPath = result.outputPath;
			const outputUrl = await resolveVideoUrl(outputPath);

			try {
				current.videoPlaybackRef.current?.pause();
			} catch {
				// The preview may already be remounting.
			}
			const preserveProjectPath = Boolean(current.project.currentProjectPath);
			if (current.appearance.webcam.sourcePath) {
				await window.electronAPI.setCurrentRecordingSession(
					{
						videoPath: outputPath,
						webcamPath: current.appearance.webcam.sourcePath,
						timeOffsetMs: current.appearance.webcam.timeOffsetMs,
					},
					{ preserveProjectPath },
				);
			} else {
				await window.electronAPI.setCurrentVideoPath(outputPath, { preserveProjectPath });
			}

			current.autoFullTrackClipIdRef.current = null;
			current.autoFullTrackClipEndMsRef.current = null;
			current.nextClipIdRef.current += 1;
			current.timeline.setClipRegions((clips) => [...clips, plan.clip]);
			current.timeline.setSelectedClipId(plan.clip.id);
			current.timeline.setSelectedZoomId(null);
			current.timeline.setSelectedAnnotationId(null);
			current.timeline.setSelectedAudioId(null);
			current.timeline.setSelectedCaptionId(null);
			current.timeline.setSourceAudioTrackSettingsByClip({});
			current.timeline.setDefaultSourceAudioTrackSettings({});
			current.timeline.setSourceAudioFallbackRefreshKey((value) => value + 1);
			current.project.setVideoSourcePath(outputPath);
			current.project.setVideoPath(outputUrl);
			current.setIsPlaying(false);
			current.setDuration(0);
			current.setCurrentTime(plan.timelineStartMs / 1000);
			current.setIsPreviewReady(false);
			current.remountPreview();
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
