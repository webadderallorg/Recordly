import type { Range } from "dnd-timeline";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatShortcut } from "@/utils/platformUtils";
import { loadEditorPreferences, saveEditorPreferences } from "../../editorPreferences";
import { useAudioPeaks } from "../useAudioPeaks";
import { calculateTimelineScale, createInitialRange, type Keyframe } from "./shared";

interface UseTimelineEditorStateParams {
	videoDuration: number;
	currentTime: number;
	playheadTime?: number;
	aspectRatio: string;
	videoPath?: string | null;
}

export function useTimelineEditorState({
	videoDuration,
	currentTime,
	playheadTime,
	aspectRatio,
	videoPath,
}: UseTimelineEditorStateParams) {
	const initialEditorPreferences = useMemo(() => loadEditorPreferences(), []);
	const totalMs = useMemo(() => Math.max(0, Math.round(videoDuration * 1000)), [videoDuration]);
	const currentTimeMs = useMemo(
		() => Math.round((playheadTime ?? currentTime) * 1000),
		[currentTime, playheadTime],
	);
	const timelineScale = useMemo(() => calculateTimelineScale(videoDuration), [videoDuration]);
	const safeMinDurationMs = useMemo(
		() =>
			totalMs > 0
				? Math.min(timelineScale.minItemDurationMs, totalMs)
				: timelineScale.minItemDurationMs,
		[timelineScale.minItemDurationMs, totalMs],
	);

	const [range, setRange] = useState<Range>(() => createInitialRange(totalMs));
	const [keyframes, setKeyframes] = useState<Keyframe[]>([]);
	const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | null>(null);
	const [selectAllBlocksActive, setSelectAllBlocksActive] = useState(false);
	const [customAspectWidth, setCustomAspectWidth] = useState(
		initialEditorPreferences.customAspectWidth,
	);
	const [customAspectHeight, setCustomAspectHeight] = useState(
		initialEditorPreferences.customAspectHeight,
	);
	const [scrollLabels, setScrollLabels] = useState({
		pan: "Shift + Ctrl + Scroll",
		zoom: "Ctrl + Scroll",
	});

	const isTimelineFocusedRef = useRef(false);
	const timelineContainerRef = useRef<HTMLDivElement>(null);
	const audioPeaks = useAudioPeaks(videoPath);

	useEffect(() => {
		setRange(createInitialRange(totalMs));
	}, [totalMs]);

	useEffect(() => {
		if (aspectRatio === "native") {
			return;
		}

		const [width, height] = aspectRatio.split(":");
		if (width && height) {
			setCustomAspectWidth(width);
			setCustomAspectHeight(height);
		}
	}, [aspectRatio]);

	useEffect(() => {
		saveEditorPreferences({
			customAspectWidth,
			customAspectHeight,
		});
	}, [customAspectHeight, customAspectWidth]);

	useEffect(() => {
		formatShortcut(["shift", "mod", "Scroll"]).then((pan) => {
			formatShortcut(["mod", "Scroll"]).then((zoom) => {
				setScrollLabels({ pan, zoom });
			});
		});
	}, []);

	return {
		totalMs,
		currentTimeMs,
		timelineScale,
		safeMinDurationMs,
		range,
		setRange,
		keyframes,
		setKeyframes,
		selectedKeyframeId,
		setSelectedKeyframeId,
		selectAllBlocksActive,
		setSelectAllBlocksActive,
		customAspectWidth,
		setCustomAspectWidth,
		customAspectHeight,
		setCustomAspectHeight,
		scrollLabels,
		isTimelineFocusedRef,
		timelineContainerRef,
		audioPeaks,
	};
}