import type { useI18n } from "@/contexts/I18nContext";
import { resolveExportStatusModel } from "../exportStatusModel";
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
	const progress = session.exportProgress;
	const exportPercentLabel = progress
		? status.isExportPreparing
			? t("editor.exportStatus.preparing", "Preparing export...")
			: status.isExportSaving
				? t("editor.exportStatus.saving", "Opening save dialog...")
				: status.isRenderingAudio
					? t("editor.exportStatus.renderingAudio", "Rendering audio {{percent}}%", {
							percent: Math.round((progress.audioProgress ?? 0) * 100),
						})
					: status.isExportFinalizing
						? settings.exportFormat === "mp4" &&
							settings.exportPipelineModel === "modern"
							? status.isExportFinalSaveIndeterminate
								? t(
										"editor.exportStatus.muxingAndSaving",
										"Muxing audio and saving file...",
									)
								: t(
										"editor.exportStatus.muxingAndSavingPercent",
										"Muxing and saving {{percent}}%",
										{ percent: status.exportFinalizingPercent ?? 100 },
									)
							: t(
									"editor.exportStatus.finalizingPercent",
									"Finalizing {{percent}}%",
									{ percent: status.exportFinalizingPercent ?? 100 },
								)
						: t("editor.exportStatus.completePercent", "{{percent}}% complete", {
								percent: Math.round(progress.percentage),
							})
		: t("editor.exportStatus.preparing", "Preparing export...");

	return { ...status, exportRenderSpeedLabel, exportPercentLabel };
}
