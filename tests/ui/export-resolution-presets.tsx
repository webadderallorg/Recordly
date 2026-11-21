import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BillingProvider, useOptionalBilling } from "@/components/billing/BillingProvider";
import { PricingModal } from "@/components/billing/PricingModal";
import { getShareResolution } from "@/components/video-editor/cloud/shareResolution";
import { ExportSettingsMenu } from "@/components/video-editor/ExportSettingsMenu";
import { loadEditorPreferences } from "@/components/video-editor/editorPreferences";
import { useExportDialogActions } from "@/components/video-editor/export/useExportDialogActions";
import { useExportDimensions } from "@/components/video-editor/export/useExportDimensions";
import { useExportSession } from "@/components/video-editor/export/useExportSession";
import { useExportSettings } from "@/components/video-editor/export/useExportSettings";
import type { VideoPlaybackRef } from "@/components/video-editor/VideoPlayback";
import { I18nProvider } from "@/contexts/I18nContext";
import type { ExportSettings } from "@/lib/exporter";
import "@/index.css";

window.electronAPI = {
	...window.electronAPI,
	getAppSetting: () => null,
	setAppSetting: async () => undefined,
} as unknown as typeof window.electronAPI;

const params = new URLSearchParams(location.search);
const limit = Number(params.get("limit") || 4096);
const cropRegion = { x: 0, y: 0, width: 1, height: 1 };
Object.defineProperty(window, "VideoEncoder", {
	value: {
		isConfigSupported: async (config: VideoEncoderConfig) => ({
			supported: config.width <= limit && config.height <= limit,
			config,
		}),
	},
});

function Fixture() {
	const billing = useOptionalBilling();
	// This fixture exercises a deliberate 60 FPS request, independent of app defaults.
	const [preferences] = useState(() => ({
		...loadEditorPreferences(),
		mp4FrameRate: 60 as const,
	}));
	const settings = useExportSettings(preferences, [], []);
	const session = useExportSession();
	const {
		exportQuality: quality,
		setExportQuality: setQuality,
		advancedExportSettings: advanced,
		setAdvancedExportSettings: setAdvanced,
		customExportResolution: custom,
		setCustomExportResolution: setCustom,
		exportEncodingMode,
		setExportEncodingMode,
	} = settings;
	const [result, setResult] = useState("");
	const [exportRequest, setExportRequest] = useState<ExportSettings & { destination?: string }>();
	const portrait = params.has("portrait");
	const videoPlaybackRef = useRef({
		video: { videoWidth: portrait ? 720 : 1280, videoHeight: portrait ? 1280 : 720 },
	} as VideoPlaybackRef);
	const dimensions = useExportDimensions({
		customExportResolution: custom,
		onCustomExportResolutionChange: setCustom,
		videoPlaybackRef,
		isPreviewReady: true,
		aspectRatio: "native",
		cropRegion,
		mp4FrameRate: settings.mp4FrameRate,
		gifSizePreset: "original",
	});
	const { handleStartExportFromDropdown, prepareExportForShare, handleRetrySaveExport } =
		useExportDialogActions({
			videoPath: "file:///fixture/source.mp4",
			videoPlaybackRef,
			hasCaptionsForSidecar: params.has("captions"),
			settings,
			session,
			recordSuccessfulExport: () => undefined,
			handleExport: async (request, options) => {
				setExportRequest({ ...request, destination: options?.destination });
				try {
					const output = await dimensions.ensureSupportedMp4SourceDimensions(
						request.mp4FrameRate ?? 60,
						request.quality,
						options?.destination === "share"
							? getShareResolution(params.has("free") ? "free" : "pro")
							: undefined,
					);
					setResult(`${output.width} × ${output.height}`);
				} catch (error) {
					setResult(error instanceof Error ? error.message : String(error));
				}
				return undefined;
			},
		});
	return (
		<div className="dark mx-auto mt-8 w-[420px] bg-background p-4 text-foreground">
			<ExportSettingsMenu
				showCaptionSidecarOption={params.has("captions")}
				includeCaptionSidecar={settings.includeCaptionSidecar}
				onIncludeCaptionSidecarChange={settings.setIncludeCaptionSidecar}
				advancedExportSettings={advanced}
				onAdvancedExportSettingsChange={setAdvanced}
				customExportResolution={custom}
				onCustomExportResolutionChange={setCustom}
				exportFormat="mp4"
				exportQuality={quality}
				onExportQualityChange={setQuality}
				exportEncodingMode={exportEncodingMode}
				onExportEncodingModeChange={setExportEncodingMode}
				mp4FrameRate={settings.mp4FrameRate}
				onMp4FrameRateChange={settings.setMp4FrameRate}
				mp4OutputDimensions={dimensions.mp4OutputDimensions}
				gifFrameRate={15}
				gifLoop
				gifSizePreset="original"
				onExport={handleStartExportFromDropdown}
			/>
			<output data-testid="export-result">{result}</output>
			<output data-testid="export-settings-result">{JSON.stringify(exportRequest)}</output>
			{params.has("captions") && (
				<>
					<output data-testid="caption-plan">
						{billing?.loading
							? "loading"
							: (billing?.status?.billing.plan ?? "unverified")}
					</output>
					<button onClick={() => void billing?.refresh()}>Refresh caption plan</button>
					<button
						onClick={() => {
							session.pendingExportSaveRef.current = {
								fileName: "caption-test.mp4",
								tempFilePath: "/tmp/caption-test.mp4",
								captionSidecar: {
									format: "both",
									cues: [{ startMs: 0, endMs: 1000, text: "Hello" }],
								},
							};
							void handleRetrySaveExport();
						}}
					>
						Retry caption save
					</button>
					<PricingModal onSignIn={() => undefined} />
				</>
			)}
			<button type="button" onClick={() => void prepareExportForShare()}>
				Prepare shared video
			</button>
		</div>
	);
}

createRoot(document.getElementById("root")!).render(
	<I18nProvider>
		{params.has("captions") ? (
			<BillingProvider>
				<Fixture />
			</BillingProvider>
		) : (
			<Fixture />
		)}
	</I18nProvider>,
);
