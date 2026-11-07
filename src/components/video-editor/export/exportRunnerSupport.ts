import type { RefObject } from "react";
import { useCallback } from "react";
import { toast } from "@/components/ui/toast";
import { translate } from "@/i18n/runtime";
import type { ExportQuality, SupportedMp4Dimensions } from "@/lib/exporter";
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
	isPlaying: boolean;
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
	remountPreview: () => void;
};

export function showExportErrorToast(message: string) {
	const summary = summarizeErrorMessage(message);
	toast.error(translate("notifications.exportFailed", "Export failed"), {
		description: summary === message ? summary : message,
		duration: Infinity,
	});
}

export function useExportSuccessToast() {
	return useCallback((filePath: string) => {
		toast.success(
			translate("notifications.exportedTo", "Exported successfully to {{path}}", {
				path: filePath,
			}),
			{
				action: {
					label: translate("notifications.showInFolder", "Show in Folder"),
					onClick: async () => {
						try {
							const result = await window.electronAPI.revealInFolder(filePath);
							if (!result.success) {
								toast.error(
									translate(
										"notifications.revealFailed",
										"Failed to reveal item in folder.",
									),
									{ description: result.error || result.message },
								);
							}
						} catch (error) {
							toast.error(
								translate(
									"notifications.revealError",
									"Failed to reveal item in folder: {{error}}",
									{ error: String(error) },
								),
							);
						}
					},
				},
			},
		);
	}, []);
}
