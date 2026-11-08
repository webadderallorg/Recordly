import { type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { AppErrorBoundary } from "@/components/feedback/AppErrorBoundary";
import { ExportErrorReportButton } from "@/components/feedback/ExportErrorReportButton";
import { Button } from "@/components/ui/button";
import { Toaster, toast } from "@/components/ui/toast";
import { DEFAULT_EDITOR_PREFERENCES } from "@/components/video-editor/editorPreferences";
import { showExportErrorToast } from "@/components/video-editor/export/exportRunnerSupport";
import { useExportSession } from "@/components/video-editor/export/useExportSession";
import { useExportSettings } from "@/components/video-editor/export/useExportSettings";
import { useExportStatusViewModel } from "@/components/video-editor/export/useExportStatusViewModel";
import { EditorExportMenu } from "@/components/video-editor/layout/EditorExportMenu";
import { I18nProvider, useI18n } from "@/contexts/I18nContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { installFeedbackDiagnostics } from "@/lib/feedback/diagnostics";
import "@/index.css";
installFeedbackDiagnostics();
console.error("Report test: decoder log /Users/Alice/private.mp4 alice@example.com");
function BrokenView(): never {
	throw new Error("Test view crashed");
}
const scenario = new URLSearchParams(location.search);
function exportFailure() {
	const engine = scenario.get("engine") === "native" ? "Native FFmpeg" : "Lightning MP4";
	return `${engine} export failed: encoder unavailable\nOutput: 1920x1080 @ 60 FPS\n${Array.from({ length: 40 }, (_, index) => `Diagnostic ${index}: /Users/Alice/private.mp4 alice@example.com`).join("\n")}\nDiagnostic tail: full failure retained`;
}
function ToastFailure() {
	return (
		<main className="p-8">
			<Button
				onClick={() => {
					if (scenario.has("title")) toast.error(exportFailure());
					else showExportErrorToast(exportFailure());
				}}
			>
				Fail export
			</Button>
			<Toaster />
		</main>
	);
}
function FailedExportMenu() {
	const { t } = useI18n();
	const exportSession = useExportSession();
	const exportSettings = useExportSettings(
		{ ...DEFAULT_EDITOR_PREFERENCES, publishDestination: "local" },
		[],
		[],
	);
	const exportStatus = useExportStatusViewModel({
		t,
		session: exportSession,
		settings: exportSettings,
	});
	const dimensions = { width: 1920, height: 1080 };
	const supported = { ...dimensions, capped: false, encoderPath: null };
	const exportDimensions: ComponentProps<typeof EditorExportMenu>["exportDimensions"] = {
		gifOutputDimensions: dimensions,
		mp4OutputDimensions: {
			hd: dimensions,
			medium: dimensions,
			good: dimensions,
			high: dimensions,
			source: dimensions,
			custom: dimensions,
		},
		supportedMp4SourceDimensions: supported,
		ensureSupportedMp4SourceDimensions: async () => supported,
	};
	return (
		<main className="flex justify-between p-8">
			<Button
				onClick={() => {
					exportSession.setExportError(exportFailure());
					exportSession.setShowExportDropdown(true);
					exportSession.setHasPendingExportSave(scenario.has("pending"));
				}}
			>
				Fail export
			</Button>
			<EditorExportMenu
				t={t}
				exportSession={exportSession}
				exportSettings={exportSettings}
				exportStatus={exportStatus}
				exportDimensions={exportDimensions}
				hasCaptionsForSidecar={false}
				nvidiaCudaExportAvailable={false}
				experimentalNvidiaCudaExport={false}
				setExperimentalNvidiaCudaExport={() => undefined}
				handleOpenExportDropdown={() => exportSession.setShowExportDropdown(true)}
				handleExportDropdownClose={() => exportSession.setShowExportDropdown(false)}
				handleCancelExport={() => undefined}
				handleRetrySaveExport={() => undefined}
				handleStartExportFromDropdown={() => undefined}
				revealExportedFile={() => undefined}
				exportMessage={null}
				projectTitle="Failed export fixture"
				prepareExportForShare={async () => undefined}
				onRequestShareSignIn={() => undefined}
				shareRequestNonce={0}
			/>
		</main>
	);
}
createRoot(document.getElementById("root")!).render(
	<ThemeProvider>
		<I18nProvider>
			<AppErrorBoundary>
				{scenario.has("menu") ? (
					<FailedExportMenu />
				) : scenario.has("toast") ? (
					<ToastFailure />
				) : scenario.has("crash") ? (
					<BrokenView />
				) : (
					<main className="p-8">
						<ExportErrorReportButton
							format="mp4"
							error="[VIDEO_DECODE_ENCODING_ERROR] private /Users/Alice/video.mp4 alice@example.com (sourceTimeSec=0.500, chunkIndex=25)"
						/>
					</main>
				)}
			</AppErrorBoundary>
		</I18nProvider>
	</ThemeProvider>,
);
