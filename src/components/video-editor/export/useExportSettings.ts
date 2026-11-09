import { useEffect, useMemo, useState } from "react";
import type {
	ExportBackendPreference,
	ExportEncodingMode,
	ExportFormat,
	ExportMp4FrameRate,
	ExportPipelineModel,
	ExportQuality,
	GifFrameRate,
	GifSizePreset,
} from "@/lib/exporter";
import { projectCaptionCues } from "../captionTimeline";
import { saveEditorPreferences, type EditorPreferences } from "../editorPreferences";
import { DEFAULT_MP4_EXPORT_FRAME_RATE } from "../exportPreferences";
import type { CaptionCue, ClipRegion } from "../types";

export function useExportSettings(
	preferences: EditorPreferences,
	autoCaptions: CaptionCue[],
	clips: ClipRegion[],
) {
	const [includeCaptionSidecar, setIncludeCaptionSidecar] = useState(
		preferences.includeCaptionSidecar,
	);
	const [publishDestination, setPublishDestination] = useState(preferences.publishDestination);
	const [advancedExportSettings, setAdvancedExportSettings] = useState(
		preferences.advancedExportSettings,
	);
	const [customExportResolution, setCustomExportResolution] = useState(
		preferences.customExportResolution,
	);
	const [exportQuality, setExportQuality] = useState<ExportQuality>(preferences.exportQuality);
	const [exportEncodingMode, setExportEncodingMode] = useState<ExportEncodingMode>(
		preferences.exportEncodingMode,
	);
	const [exportBackendPreference, setExportBackendPreference] = useState<ExportBackendPreference>(
		preferences.exportBackendPreference,
	);
	const [exportPipelineModel, setExportPipelineModel] = useState<ExportPipelineModel>(
		preferences.exportPipelineModel,
	);
	const [mp4FrameRate, setMp4FrameRate] = useState<ExportMp4FrameRate>(
		preferences.mp4FrameRate ?? DEFAULT_MP4_EXPORT_FRAME_RATE,
	);
	const [exportFormat, setExportFormat] = useState<ExportFormat>(preferences.exportFormat);
	const [gifFrameRate, setGifFrameRate] = useState<GifFrameRate>(preferences.gifFrameRate);
	const [gifOptimizeSize, setGifOptimizeSize] = useState(false);
	const [gifLoop, setGifLoop] = useState(preferences.gifLoop);
	const [gifSizePreset, setGifSizePreset] = useState<GifSizePreset>(preferences.gifSizePreset);
	useEffect(() => {
		saveEditorPreferences({
			advancedExportSettings,
			customExportResolution,
			publishDestination,
			includeCaptionSidecar,
			exportQuality,
			exportEncodingMode,
			exportBackendPreference,
			exportPipelineModel,
			mp4FrameRate,
			exportFormat,
			gifFrameRate,
			gifLoop,
			gifSizePreset,
		});
	}, [
		advancedExportSettings,
		customExportResolution,
		publishDestination,
		includeCaptionSidecar,
		exportQuality,
		exportEncodingMode,
		exportBackendPreference,
		exportPipelineModel,
		mp4FrameRate,
		exportFormat,
		gifFrameRate,
		gifLoop,
		gifSizePreset,
	]);

	const captionSidecarCues = useMemo(
		() =>
			projectCaptionCues(autoCaptions, clips)
				.filter(
					(cue) =>
						Number.isFinite(cue.startMs) &&
						Number.isFinite(cue.endMs) &&
						cue.endMs > cue.startMs &&
						typeof cue.text === "string" &&
						cue.text.trim().length > 0,
				)
				.map(({ startMs, endMs, text }) => ({ startMs, endMs, text })),
		[autoCaptions, clips],
	);

	return {
		publishDestination,
		setPublishDestination,
		includeCaptionSidecar,
		setIncludeCaptionSidecar,
		exportQuality,
		setExportQuality,
		advancedExportSettings,
		setAdvancedExportSettings,
		customExportResolution,
		setCustomExportResolution,
		exportEncodingMode: advancedExportSettings ? exportEncodingMode : ("balanced" as const),
		setExportEncodingMode,
		exportBackendPreference,
		setExportBackendPreference,
		exportPipelineModel,
		setExportPipelineModel,
		mp4FrameRate: advancedExportSettings ? mp4FrameRate : DEFAULT_MP4_EXPORT_FRAME_RATE,
		setMp4FrameRate,
		exportFormat,
		setExportFormat,
		gifFrameRate: advancedExportSettings ? gifFrameRate : (15 as const),
		setGifFrameRate,
		gifLoop,
		setGifLoop,
		gifOptimizeSize,
		setGifOptimizeSize,
		gifSizePreset,
		setGifSizePreset,
		captionSidecarCues,
	};
}
