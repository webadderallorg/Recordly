import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectPreviewData } from "@/types/projectPreview";
import { getAspectRatioValue } from "@/utils/aspectRatioUtils";
import VideoPlayback, { type VideoPlaybackRef } from "../VideoPlayback";
import { normalizeProjectEditor } from "../projectPersistence";
import type { CursorTelemetryPoint } from "../types";
import { getEffectiveNativeAspectRatio } from "../videoPlayback/playbackTypes";

const ignore = () => undefined;
/** One muted five-second pass through the saved timeline using the editor renderer. */
export function ProjectHoverPreview({
	data,
	onFinish,
}: {
	data: ProjectPreviewData;
	onFinish: () => void;
}) {
	const editor = useMemo(() => normalizeProjectEditor(data.project.editor), [data]);
	const playback = useRef<VideoPlaybackRef>(null);
	const started = useRef(false);
	const [time, setTime] = useState(0);
	const [playing, setPlaying] = useState(false);
	const [duration, setDuration] = useState(0);
	const [sourceDimensions, setSourceDimensions] = useState<{
		width: number;
		height: number;
	} | null>(null);
	const aspectRatio = getAspectRatioValue(
		editor.aspectRatio,
		getEffectiveNativeAspectRatio(sourceDimensions, editor.cropRegion),
	);
	const updateDuration = useCallback((seconds: number) => {
		setDuration(seconds);
		const video = playback.current?.video;
		if (video?.videoWidth && video.videoHeight) {
			setSourceDimensions({ width: video.videoWidth, height: video.videoHeight });
		}
	}, []);
	const [telemetry, setTelemetry] = useState<CursorTelemetryPoint[]>([]);
	const clips = useMemo(
		() =>
			editor.clipRegions.length
				? editor.clipRegions
				: duration > 0
					? [
							{
								id: "hover-preview",
								startMs: 0,
								endMs: duration * 1000,
								sourceStartMs: 0,
								speed: 1,
							},
						]
					: [],
		[editor.clipRegions, duration],
	);
	useEffect(() => {
		let active = true;
		void window.electronAPI
			.getCursorTelemetry(data.project.videoPath)
			.then((result) => {
				if (active && result.success) setTelemetry(result.samples);
			})
			.catch(ignore);
		return () => {
			active = false;
		};
	}, [data.project.videoPath]);
	const updateTime = useCallback(
		(seconds: number) => {
			if (seconds >= 5) {
				playback.current?.pause();
				onFinish();
			} else setTime(seconds);
		},
		[onFinish],
	);
	const updatePlaying = useCallback(
		(value: boolean) => {
			setPlaying(value);
			if (value) started.current = true;
			else if (started.current) onFinish();
		},
		[onFinish],
	);
	useEffect(() => {
		// A stalled decoder or unavailable GPU must leave the static thumbnail usable.
		const timeout = window.setTimeout(onFinish, 15000);
		const stopWhenHidden = () => {
			if (document.hidden) onFinish();
		};
		document.addEventListener("visibilitychange", stopWhenHidden);
		return () => {
			clearTimeout(timeout);
			document.removeEventListener("visibilitychange", stopWhenHidden);
			playback.current?.pause();
		};
	}, [onFinish]);
	return (
		<div
			data-project-hover-preview
			className={`pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden rounded-xl ${playing ? "opacity-100" : "opacity-0"}`}
			aria-hidden="true"
		>
			<div
				className="shrink-0"
				style={{ width: `${Math.max(100, (aspectRatio / (4 / 3)) * 100)}%` }}
			>
				<VideoPlayback
					{...editor}
					autoPlay
					ref={playback}
					videoPath={data.videoUrl}
					webcamVideoPath={data.webcamUrl}
					clipRegions={clips}
					showShadow={editor.shadowIntensity > 0}
					currentTime={time}
					isPlaying={playing}
					volume={0}
					cursorTelemetry={telemetry}
					selectedZoomId={null}
					onSelectZoom={ignore}
					onZoomFocusChange={ignore}
					onDurationChange={updateDuration}
					onTimeUpdate={updateTime}
					onPlayStateChange={updatePlaying}
					onError={onFinish}
				/>
			</div>
		</div>
	);
}
