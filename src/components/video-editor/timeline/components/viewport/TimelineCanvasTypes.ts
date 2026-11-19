import { type MouseEventHandler } from "react";
import type {
	SourceAudioTrackSettings,
	SourceAudioTrackWithPeaks,
} from "@/components/video-editor/audio/audioTypes";
import type { TimelineRenderItem } from "../../core/timelineTypes";

export interface TimelineCanvasProps {
	videoPath?: string | null;
	items: TimelineRenderItem[];
	videoDurationMs: number;
	currentTimeMs: number;
	onSeek?: (time: number) => void;
	canPlaceZoomAtMs?: (startMs: number) => boolean;
	onApplyAutoZooms?: () => void;
	onSelectZoom?: (id: string | null) => void;
	onSelectClip?: (id: string | null, extend?: boolean) => void;
	onSelectAnnotation?: (id: string | null) => void;
	onSelectAudio?: (id: string | null) => void;
	onSelectCaption?: (id: string | null) => void;
	onAddZoomAtMs?: (startMs: number) => void;
	onAddCaptionAtMs?: (startMs: number) => void;
	canPlaceCaptionAtMs?: (startMs: number) => boolean;
	resolveCaptionSpanAtMs?: (startMs: number) => { start: number; end: number } | null;
	captionsEnabled?: boolean;
	captionQuickAddEnabled?: boolean;
	selectedZoomId: string | null;
	selectedClipId?: string | null;
	selectedClipIds?: string[];
	selectedAnnotationId?: string | null;
	selectedAudioId?: string | null;
	selectedCaptionId?: string | null;
	selectAllBlocksActive?: boolean;
	onClearBlockSelection?: () => void;
	keyframes?: { id: string; time: number }[];
	sourceAudioTracks?: SourceAudioTrackWithPeaks[];
	getSourceAudioTrackSettingsForClip?: (clipId: string | null) => SourceAudioTrackSettings;
	showSourceAudioTrack?: boolean;
	liveSpanPreviewById?: Record<string, { start: number; end: number }>;
	liveHiddenItemIds?: string[];
	isDragging?: boolean;
	isLoading?: boolean;
}

export interface TimelineCanvasRowsProps {
	videoPath?: string | null;
	items: TimelineRenderItem[];
	videoDurationMs: number;
	selectAllBlocksActive: boolean;
	selectedZoomId: string | null;
	selectedClipId?: string | null;
	selectedClipIds?: string[];
	selectedAnnotationId?: string | null;
	selectedAudioId?: string | null;
	selectedCaptionId?: string | null;
	onApplyAutoZooms?: () => void;
	onDismissAutoZooms: () => void;
	onSelectZoom?: (id: string | null) => void;
	onSelectClip?: (id: string | null, extend?: boolean) => void;
	onSelectAnnotation?: (id: string | null) => void;
	onSelectAudio?: (id: string | null) => void;
	onSelectCaption?: (id: string | null) => void;
	sourceAudioTracks?: SourceAudioTrackWithPeaks[];
	getSourceAudioTrackSettingsForClip?: (clipId: string | null) => SourceAudioTrackSettings;
	showSourceAudioTrack?: boolean;
	liveSpanPreviewById?: Record<string, { start: number; end: number }>;
	liveHiddenItemIds?: string[];
	direction: string;
	canShowGhostZoom: boolean;
	ghostStartMs: number | null;
	ghostWidthPx: number;
	onZoomRowMouseEnter: MouseEventHandler<HTMLDivElement>;
	onZoomRowMouseMove: MouseEventHandler<HTMLDivElement>;
	onZoomRowMouseLeave: () => void;
	onZoomRowMouseDown?: MouseEventHandler<HTMLDivElement>;
	onZoomRowClick?: MouseEventHandler<HTMLDivElement>;
	captionsEnabled?: boolean;
	canShowGhostCaption: boolean;
	captionGhostStartMs: number | null;
	captionGhostWidthPx: number;
	onCaptionRowMouseEnter: MouseEventHandler<HTMLDivElement>;
	onCaptionRowMouseMove: MouseEventHandler<HTMLDivElement>;
	onCaptionRowMouseLeave: MouseEventHandler<HTMLDivElement>;
	onCaptionRowMouseDown: MouseEventHandler<HTMLDivElement>;
	onCaptionRowClick: MouseEventHandler<HTMLDivElement>;
}
