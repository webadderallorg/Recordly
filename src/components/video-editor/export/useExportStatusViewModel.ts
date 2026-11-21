import type { useI18n } from "@/contexts/I18nContext";
import { resolveExportStatusModel } from "../exportStatusModel";
import { EXPORT_LOADING_MESSAGES, type ExportLoadingMessage } from "./exportLoadingMessages";
import type { useExportSession } from "./useExportSession";
import type { useExportSettings } from "./useExportSettings";

type Input = {
	t: ReturnType<typeof useI18n>["t"];
	session: ReturnType<typeof useExportSession>;
	settings: ReturnType<typeof useExportSettings>;
};

export function useExportStatusViewModel({ t, session, settings }: Input) {
	const status = resolveExportStatusModel({
		isExporting: session.isExporting,
		exportProgress: session.exportProgress,
		exportFormat: settings.exportFormat,
		exportPipelineModel: settings.exportPipelineModel,
	});
	const exportRenderSpeedLabel = status.renderSpeedFps
		? t("editor.exportStatus.renderSpeed", "Render speed {{fps}} FPS", {
				fps: status.renderSpeedFps,
			})
		: null;
	let exportPhaseLabel = t("editor.exportStatus.exporting", "Exporting");
	let exportHeadlines: readonly ExportLoadingMessage[] | undefined;
	if (session.isOptimizingGif) {
		exportPhaseLabel = t("editor.exportStatus.optimizingGif", "Optimizing GIF…");
	} else if (status.isExportSaving) {
		exportPhaseLabel =
			settings.exportFormat === "gif"
				? t("editor.exportStatus.savingGif", "Saving GIF…")
				: t("editor.exportStatus.savingVideo", "Saving video…");
	} else if (status.isExportFinalizing) {
		exportPhaseLabel = status.isGifFinalizing
			? t("editor.exportStatus.encodingGif", "Finishing GIF…")
			: t("editor.exportStatus.finishingVideo", "Finishing video…");
	} else {
		exportHeadlines = EXPORT_LOADING_MESSAGES;
	}
	return {
		...status,
		exportRenderSpeedLabel,
		exportPhaseLabel,
		exportHeadlines,
	};
}
