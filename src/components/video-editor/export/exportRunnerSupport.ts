import type { RefObject } from "react";
import { toast } from "@/components/ui/toast";
import { translate } from "@/i18n/runtime";
import type { ExportQuality, SupportedMp4Dimensions } from "@/lib/exporter";
import { RENDERER_LAYER_OMITTED_EVENT } from "@/lib/exporter/rendererMedia";
import type { useVideoEditorAudio } from "../audio/useVideoEditorAudio";
import type { ShareResolution } from "../cloud/shareResolution";
import type { Mp4ExportRouting } from "../mp4ExportRouting";
import type { getSmokeExportConfig } from "../smokeExportConfig";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useTimelineState } from "../state/useTimelineState";
import type { CursorTelemetryPoint, SpeedRegion, ZoomRegion } from "../types";
import type { VideoPlaybackRef } from "../VideoPlayback";
import { summarizeErrorMessage } from "../videoEditorUtils";
import type { PendingExportSave } from "./exportPersistence";
import type { useExportSession } from "./useExportSession";
import type { useExportSettings } from "./useExportSettings";

export type ExportRunnerInput = {
	exportIdentity?: import("../dashboard/libraryExportHistory").LibraryExportIdentity;
	projectName: string;
	videoPath: string | null;
	videoPlaybackRef: RefObject<VideoPlaybackRef | null>;
	appearance: ReturnType<typeof useAppearanceState>;
	timeline: ReturnType<typeof useTimelineState>;
	exportSettings: ReturnType<typeof useExportSettings>;
	exportSession: ReturnType<typeof useExportSession>;
	audio: ReturnType<typeof useVideoEditorAudio>;
	smokeExportConfig: ReturnType<typeof getSmokeExportConfig>;
	effectiveSpeedRegions: SpeedRegion[];
	effectiveZoomRegions: ZoomRegion[];
	effectiveCursorTelemetry: CursorTelemetryPoint[];
	effectiveShowCursor: boolean;
	ensureSupportedMp4SourceDimensions: (
		frameRate: ReturnType<typeof useExportSettings>["mp4FrameRate"],
		quality?: ExportQuality,
		shareResolution?: ShareResolution,
		route?: Pick<Mp4ExportRouting, "pipelineModel" | "backendPreference">,
	) => Promise<SupportedMp4Dimensions>;
	captionSidecarPayload?: PendingExportSave["captionSidecar"];
	experimentalNvidiaCudaExport: boolean;
	nvidiaCudaExportAvailable: boolean;
};

export function showExportErrorToast(message: string) {
	const summary = summarizeErrorMessage(message);
	toast.error(translate("notifications.exportFailed", "Export failed"), {
		description: summary === message ? summary : message,
		duration: Infinity,
	});
}

/**
 * An unreadable webcam doesn't fail the export, but the result then differs from the edit.
 * Track the renderer's omission signal per attempt so the user hears about it.
 */
export function trackOmittedExportLayers(
	record: (event: string, details?: Record<string, unknown>) => void,
) {
	let webcamOmitted = false;
	return {
		onDiagnostic(event: string, details: Record<string, unknown>) {
			if (event === RENDERER_LAYER_OMITTED_EVENT && details.asset === "webcam")
				webcamOmitted = true;
			record(event, details);
		},
		resetAttempt() {
			webcamOmitted = false;
		},
		warnIfOmitted(result: { success: boolean }) {
			if (!result.success || !webcamOmitted) return;
			toast.warning(
				translate(
					"editor.exportStatus.webcamOmitted",
					"The webcam recording couldn't be read, so this export doesn't include the webcam overlay.",
				),
				{ duration: Infinity },
			);
		},
	};
}

export function showCaptionSidecarWarning(result: {
	success: boolean;
	captionSidecarFailed?: boolean;
}) {
	if (!result.success || !result.captionSidecarFailed) return;
	toast.warning(
		translate(
			"notifications.captionFilesSaveFailed",
			"Video saved, but some caption files could not be saved.",
		),
		{ duration: Infinity },
	);
}
