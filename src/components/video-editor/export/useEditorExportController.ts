import { useOptionalBilling } from "@/components/billing/BillingProvider";
import { getShareResolution } from "../cloud/shareResolution";
import { type RefObject, useEffect } from "react";
import {
	estimateMp4FileBytes,
	getEditedExportDurationSeconds,
} from "@/lib/exporter/exportSizeEstimate";
import type { useI18n } from "@/contexts/I18nContext";
import type { useVideoEditorAudio } from "../audio/useVideoEditorAudio";
import type { getSmokeExportConfig } from "../smokeExportConfig";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useTimelineState } from "../state/useTimelineState";
import type { CursorTelemetryPoint, SpeedRegion, ZoomRegion } from "../types";
import type { VideoPlaybackRef } from "../VideoPlayback";
import { useExportDialogActions } from "./useExportDialogActions";
import type { useExportDimensions } from "./useExportDimensions";
import { useExportRunner } from "./useExportRunner";
import type { useExportSession } from "./useExportSession";
import type { useExportSettings } from "./useExportSettings";
import { useExportStatusViewModel } from "./useExportStatusViewModel";
import { useSmokeExportAutomation } from "./useSmokeExportAutomation";

type Input = {
	exportIdentity?: import("../dashboard/libraryExportHistory").LibraryExportIdentity;
	t: ReturnType<typeof useI18n>["t"];
	projectName: string;
	videoPath: string | null;
	videoSourcePath: string | null;
	videoPlaybackRef: RefObject<VideoPlaybackRef | null>;
	isPlaying: boolean;
	duration: number;
	error: string | null;
	loading: boolean;
	isPreviewReady: boolean;
	appearance: ReturnType<typeof useAppearanceState>;
	timeline: ReturnType<typeof useTimelineState>;
	settings: ReturnType<typeof useExportSettings>;
	session: ReturnType<typeof useExportSession>;
	dimensions: ReturnType<typeof useExportDimensions>;
	audio: ReturnType<typeof useVideoEditorAudio>;
	smokeConfig: ReturnType<typeof getSmokeExportConfig>;
	effectiveSpeedRegions: SpeedRegion[];
	effectiveZoomRegions: ZoomRegion[];
	effectiveCursorTelemetry: CursorTelemetryPoint[];
	effectiveShowCursor: boolean;
	cursorTelemetrySourcePath: string | null;
	hasCaptionsForSidecar: boolean;
	captionSidecarPayload?: Parameters<typeof useExportRunner>[0]["captionSidecarPayload"];
	experimentalNvidiaCudaExport: boolean;
	nvidiaCudaExportAvailable: boolean;
};

export function useEditorExportController(input: Input) {
	const billing = useOptionalBilling();
	const sharing = input.settings.publishDestination === "link";
	const dimensions =
		input.dimensions.mp4OutputDimensions[sharing ? "source" : input.settings.exportQuality];
	const durationSeconds = getEditedExportDurationSeconds({
		durationSeconds: input.duration,
		clipRegions: input.timeline.clipRegions,
		trimRegions: input.timeline.trimRegions,
		speedRegions: input.effectiveSpeedRegions,
	});
	const mp4SizeEstimate =
		dimensions && durationSeconds !== null
			? estimateMp4FileBytes({
					...dimensions,
					cloudResolution: sharing
						? getShareResolution(
								billing?.loading ? undefined : billing?.status?.billing.plan,
							)
						: undefined,
					durationSeconds,
					quality: input.settings.exportQuality,
					frameRate: input.settings.mp4FrameRate,
					encodingMode: input.settings.exportEncodingMode,
					includeAudio:
						input.audio.sourceAudioTrackMeta.length > 0 ||
						input.timeline.audioRegions.length > 0,
				})
			: null;
	const { setMp4SizeEstimate } = input.session;
	useEffect(() => setMp4SizeEstimate(mp4SizeEstimate), [mp4SizeEstimate, setMp4SizeEstimate]);
	const runner = useExportRunner({
		projectName: input.projectName,
		exportIdentity: input.exportIdentity,
		videoPath: input.videoPath,
		videoPlaybackRef: input.videoPlaybackRef,
		isPlaying: input.isPlaying,
		appearance: input.appearance,
		timeline: input.timeline,
		exportSettings: input.settings,
		exportSession: input.session,
		audio: input.audio,
		smokeExportConfig: input.smokeConfig,
		effectiveSpeedRegions: input.effectiveSpeedRegions,
		effectiveZoomRegions: input.effectiveZoomRegions,
		effectiveCursorTelemetry: input.effectiveCursorTelemetry,
		effectiveShowCursor: input.effectiveShowCursor,
		ensureSupportedMp4SourceDimensions: input.dimensions.ensureSupportedMp4SourceDimensions,
		captionSidecarPayload: input.captionSidecarPayload,
		experimentalNvidiaCudaExport:
			input.experimentalNvidiaCudaExport &&
			(input.settings.advancedExportSettings || input.smokeConfig.enabled),
		nvidiaCudaExportAvailable: input.nvidiaCudaExportAvailable,
	});
	const dialogActions = useExportDialogActions({
		videoPath: input.videoPath,
		videoPlaybackRef: input.videoPlaybackRef,
		hasCaptionsForSidecar: input.hasCaptionsForSidecar,
		settings: input.settings,
		session: input.session,
		handleExport: runner.handleExport,
		recordSuccessfulExport: runner.recordSuccessfulExport,
	});
	useSmokeExportAutomation({
		config: input.smokeConfig,
		cursorTelemetrySourcePath: input.cursorTelemetrySourcePath,
		duration: input.duration,
		error: input.error,
		isPreviewReady: input.isPreviewReady,
		loading: input.loading,
		videoPath: input.videoPath,
		videoSourcePath: input.videoSourcePath,
		handleExport: runner.handleExport,
	});
	const status = useExportStatusViewModel({
		t: input.t,
		session: input.session,
		settings: input.settings,
	});
	return { dialogActions, status };
}
