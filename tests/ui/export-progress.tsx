import { type ComponentProps, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { loadEditorPreferences } from "@/components/video-editor/editorPreferences";
import type { ExportProgress } from "@/lib/exporter";
import { useExportSession } from "@/components/video-editor/export/useExportSession";
import { useExportSettings } from "@/components/video-editor/export/useExportSettings";
import { useExportStatusViewModel } from "@/components/video-editor/export/useExportStatusViewModel";
import { EditorExportMenu } from "@/components/video-editor/layout/EditorExportMenu";
import { I18nProvider, useI18n } from "@/contexts/I18nContext";
import "@/index.css";

window.electronAPI = {
	getAppSetting: () => null,
	setAppSetting: async () => undefined,
	getAppVersion: async () => "1.4.0",
	getAnnouncements: async () => ({
		settings: {},
		announcements: [
			{
				id: "promotion",
				title: "Promotional announcement",
				body: "Extra announcement content",
				audience: "editor",
				priority: 100,
				presentation: "export",
			},
		],
	}),
	onCloudShareProgress: () => () => undefined,
	cloudShareManage: async () => ({ success: true, videos: [] }),
	cloudShareCancel: async () => ({ success: true }),
} as unknown as typeof window.electronAPI;

const query = new URLSearchParams(location.search);
let cancelPreparation: (() => void) | undefined;

function Fixture() {
	const { t } = useI18n();
	const exportSettings = useExportSettings(loadEditorPreferences(), [], []);
	const exportSession = useExportSession();
	const exportStatus = useExportStatusViewModel({
		t,
		session: exportSession,
		settings: exportSettings,
	});
	useEffect(() => {
		const receiveProgress = (event: Event) =>
			exportSession.setExportProgress((event as CustomEvent<ExportProgress | null>).detail);
		window.addEventListener("export-fixture-progress", receiveProgress);
		return () => window.removeEventListener("export-fixture-progress", receiveProgress);
	}, [exportSession.setExportProgress]);
	useEffect(() => {
		exportSettings.setPublishDestination(query.has("link") ? "link" : "local");
		exportSettings.setExportPipelineModel(query.has("legacy") ? "legacy" : "modern");
		if (query.has("gif")) exportSettings.setExportFormat("gif");
		exportSession.setShowExportDropdown(true);
		exportSession.setIsExporting(!query.has("saved") && !query.has("link"));
		if (query.has("saved")) exportSession.setExportedFilePath("/tmp/export.gif");
		exportSession.setIsOptimizingGif(query.has("optimizing"));
		exportSession.setExportProgress({
			phase: query.has("preparing")
				? "preparing"
				: query.has("saving")
					? "saving"
					: query.has("finalizing") || query.has("audio") || query.has("optimizing")
						? "finalizing"
						: "extracting",
			audioProgress: query.has("audio") ? 0.42 : undefined,
			percentage: query.has("complete-frames") ? 100 : 42,
			renderProgress: query.has("complete-frames") ? 100 : undefined,
			currentFrame: 42,
			totalFrames: 100,
			renderFps: 123,
			renderBackend: "webgpu",
			encodeBackend: "ffmpeg",
			encoderName: "h264_videotoolbox",
			nativeStaticLayoutSkipReasons: ["camera overlay enabled"],
		});
	}, [
		exportSettings.setPublishDestination,
		exportSettings.setExportPipelineModel,
		exportSettings.setExportFormat,
		exportSession.setShowExportDropdown,
		exportSession.setIsExporting,
		exportSession.setExportedFilePath,
		exportSession.setIsOptimizingGif,
		exportSession.setExportProgress,
	]);
	return (
		<main className="p-8 flex justify-end">
			<EditorExportMenu
				t={t}
				exportSettings={exportSettings}
				exportSession={exportSession}
				exportStatus={exportStatus}
				exportDimensions={
					{
						gifOutputDimensions: { width: 640, height: 360 },
						mp4OutputDimensions: Object.fromEntries(
							["hd", "custom", "medium", "good", "high", "source"].map((quality) => [
								quality,
								{ width: 1920, height: 1080 },
							]),
						),
					} as ComponentProps<typeof EditorExportMenu>["exportDimensions"]
				}
				hasCaptionsForSidecar={false}
				nvidiaCudaExportAvailable={false}
				experimentalNvidiaCudaExport={false}
				setExperimentalNvidiaCudaExport={() => undefined}
				handleOpenExportDropdown={() => exportSession.setShowExportDropdown(true)}
				handleExportDropdownClose={() => exportSession.setShowExportDropdown(false)}
				handleCancelExport={() => {
					document.documentElement.dataset.cancelled = "true";
					cancelPreparation?.();
				}}
				handleRetrySaveExport={() => undefined}
				handleStartExportFromDropdown={() => undefined}
				revealExportedFile={() => undefined}
				projectTitle="Fixture"
				authToken={query.has("signed-out") ? undefined : "fixture"}
				accountId={query.has("signed-out") ? undefined : "fixture-account"}
				prepareExportForShare={async () => {
					exportSession.setIsExporting(true);
					// Hold preparation so the real share flow can display and cancel progress.
					return new Promise<string | undefined>((resolve) => {
						cancelPreparation = () => resolve(undefined);
					});
				}}
				onRequestShareSignIn={() => undefined}
				shareRequestNonce={0}
			/>
		</main>
	);
}

createRoot(document.getElementById("root")!).render(
	<I18nProvider>
		<Fixture />
	</I18nProvider>,
);
