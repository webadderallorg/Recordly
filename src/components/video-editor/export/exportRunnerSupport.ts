import type { RefObject } from "react";
import { useCallback } from "react";
import { toast } from "sonner";
import type { useI18n } from "@/contexts/I18nContext";
import type { SupportedMp4Dimensions } from "@/lib/exporter";
import type { useVideoEditorAudio } from "../audio/useVideoEditorAudio";
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
	t: ReturnType<typeof useI18n>["t"];
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
	) => Promise<SupportedMp4Dimensions>;
	captionSidecarPayload?: PendingExportSave["captionSidecar"];
	experimentalNvidiaCudaExport: boolean;
	nvidiaCudaExportAvailable: boolean;
	remountPreview: () => void;
};

export function showExportErrorToast(message: string) {
	const summary = summarizeErrorMessage(message);
	toast.error(summary, {
		description: summary === message ? undefined : message,
		duration: 20_000,
	});
}

export function useExportSuccessToast(t: ReturnType<typeof useI18n>["t"]) {
	return useCallback(
		(filePath: string) => {
			toast.success(
				t("editor.exportStatus.successToPath", "Exported successfully to {{path}}", {
					path: filePath,
				}),
				{
					action: {
						label: t("editor.exportStatus.showInFolder", "Show in Folder"),
						onClick: async () => {
							try {
								const result = await window.electronAPI.revealInFolder(filePath);
								if (!result.success) {
									toast.error(
										result.error ||
											result.message ||
											t(
												"editor.exportStatus.revealFailed",
												"Failed to reveal item in folder.",
											),
									);
								}
							} catch (error) {
								toast.error(
									t(
										"editor.exportStatus.revealError",
										"Error revealing in folder: {{error}}",
										{
											error: String(error),
										},
									),
								);
							}
						},
					},
				},
			);
		},
		[t],
	);
}
