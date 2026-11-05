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
	const exportPercentLabel =
		status.isExportPreparing || !progress
			? t("editor.exportStatus.preparing", "Preparing export...")
			: status.isExportSaving || (status.isExportFinalizing && !status.isRenderingAudio)
				? null
				: t("editor.exportStatus.completePercent", "{{percent}}% complete", {
						percent: Math.round(
							status.isRenderingAudio
								? (progress.audioProgress ?? 0) * 100
								: status.exportDisplayProgress,
						),
					});

	return { ...status, exportRenderSpeedLabel, exportPercentLabel };
}
