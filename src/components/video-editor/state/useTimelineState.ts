import { useState } from "react";
import type { SourceAudioTrackSettings } from "../audio/audioTypes";
import type {
	AnnotationRegion,
	AudioRegion,
	AutoCaptionSettings,
	CaptionCue,
	ClipRegion,
	CursorTelemetryPoint,
	SpeedRegion,
	TrimRegion,
	ZoomRegion,
} from "../types";
import { DEFAULT_AUTO_CAPTION_SETTINGS } from "../types";

export function useTimelineState() {
	const [zoomRegions, setZoomRegions] = useState<ZoomRegion[]>([]);
	const [cursorTelemetry, setCursorTelemetry] = useState<CursorTelemetryPoint[]>([]);
	const [cursorTelemetrySourcePath, setCursorTelemetrySourcePath] = useState<string | null>(null);
	const [selectedZoomId, setSelectedZoomId] = useState<string | null>(null);
	const [trimRegions, setTrimRegions] = useState<TrimRegion[]>([]);
	const [clipRegions, setClipRegions] = useState<ClipRegion[]>([]);
	const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
	const [speedRegions, setSpeedRegions] = useState<SpeedRegion[]>([]);
	const [annotationRegions, setAnnotationRegions] = useState<AnnotationRegion[]>([]);
	const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
	const [audioRegions, setAudioRegions] = useState<AudioRegion[]>([]);
	const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null);
	const [selectedCaptionId, setSelectedCaptionId] = useState<string | null>(null);
	const [sourceAudioTrackSettingsByClip, setSourceAudioTrackSettingsByClip] = useState<
		Record<string, SourceAudioTrackSettings>
	>({});
	const [defaultSourceAudioTrackSettings, setDefaultSourceAudioTrackSettings] =
		useState<SourceAudioTrackSettings>({});
	const [sourceAudioFallbackRefreshKey, setSourceAudioFallbackRefreshKey] = useState(0);
	const [hasClipSourceAudio, setHasClipSourceAudio] = useState(false);
	const [autoCaptions, setAutoCaptions] = useState<CaptionCue[]>([]);
	const [autoCaptionSettings, setAutoCaptionSettings] = useState<AutoCaptionSettings>(
		DEFAULT_AUTO_CAPTION_SETTINGS,
	);

	return {
		zoomRegions,
		setZoomRegions,
		cursorTelemetry,
		setCursorTelemetry,
		cursorTelemetrySourcePath,
		setCursorTelemetrySourcePath,
		selectedZoomId,
		setSelectedZoomId,
		trimRegions,
		setTrimRegions,
		clipRegions,
		setClipRegions,
		selectedClipId,
		setSelectedClipId,
		speedRegions,
		setSpeedRegions,
		annotationRegions,
		setAnnotationRegions,
		selectedAnnotationId,
		setSelectedAnnotationId,
		audioRegions,
		setAudioRegions,
		selectedAudioId,
		setSelectedAudioId,
		selectedCaptionId,
		setSelectedCaptionId,
		sourceAudioTrackSettingsByClip,
		setSourceAudioTrackSettingsByClip,
		defaultSourceAudioTrackSettings,
		setDefaultSourceAudioTrackSettings,
		sourceAudioFallbackRefreshKey,
		setSourceAudioFallbackRefreshKey,
		hasClipSourceAudio,
		setHasClipSourceAudio,
		autoCaptions,
		setAutoCaptions,
		autoCaptionSettings,
		setAutoCaptionSettings,
	};
}
