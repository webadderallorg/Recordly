import type { Span } from "dnd-timeline";
import type { ShortcutBinding } from "@/lib/shortcuts";
import type { ZoomMode } from "../../types";

export interface TimelineRegionSpan {
	id: string;
	start: number;
	end: number;
	rowId: string;
}

export interface TimelineRegion {
	id: string;
	startMs: number;
	endMs: number;
}

export interface TimelineAudioRegion extends TimelineRegion {
	trackIndex?: number;
}

export interface TimelineShortcutBindings {
	addKeyframe: ShortcutBinding;
	addZoom: ShortcutBinding;
	addTrim: ShortcutBinding;
	splitClip: ShortcutBinding;
	addAnnotation: ShortcutBinding;
	deleteSelected: ShortcutBinding;
}

export interface TimelineRenderItem {
	id: string;
	rowId: string;
	span: Span;
	label: string;
	zoomDepth?: number;
	zoomMode?: ZoomMode;
	speedValue?: number;
	variant: "zoom" | "trim" | "clip" | "annotation" | "speed" | "audio";
}

export interface AudioPeaksData {
	durationMs: number;
	peaks: Float32Array;
}
