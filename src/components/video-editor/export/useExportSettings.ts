import { useMemo, useState } from "react";
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
import type { EditorPreferences } from "../editorPreferences";
import type { CaptionCue, ClipRegion } from "../types";

const DEFAULT_MP4_EXPORT_FRAME_RATE: ExportMp4FrameRate = 30;

export function useExportSettings(
	preferences: EditorPreferences,
	autoCaptions: CaptionCue[],
	clips: ClipRegion[],
) {
	const [includeCaptionSidecar, setIncludeCaptionSidecar] = useState(false);
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
	const [gifLoop, setGifLoop] = useState(preferences.gifLoop);
	const [gifSizePreset, setGifSizePreset] = useState<GifSizePreset>(preferences.gifSizePreset);
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
		includeCaptionSidecar,
		setIncludeCaptionSidecar,
		exportQuality,
		setExportQuality,
		exportEncodingMode,
		setExportEncodingMode,
		exportBackendPreference,
		setExportBackendPreference,
		exportPipelineModel,
		setExportPipelineModel,
		mp4FrameRate,
		setMp4FrameRate,
		exportFormat,
		setExportFormat,
		gifFrameRate,
		setGifFrameRate,
		gifLoop,
		setGifLoop,
		gifSizePreset,
		setGifSizePreset,
		captionSidecarCues,
	};
}
