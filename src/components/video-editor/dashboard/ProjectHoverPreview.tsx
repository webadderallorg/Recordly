import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ProjectPreviewData } from "@/types/projectPreview";
import { getAspectRatioValue } from "@/utils/aspectRatioUtils";
import { normalizeProjectEditor } from "../projectPersistence";
import type { CursorTelemetryPoint } from "../types";
import VideoPlayback, { type VideoPlaybackRef } from "../VideoPlayback";
import { getEffectiveNativeAspectRatio } from "../videoPlayback/playbackTypes";
import { useProjectHoverComposition } from "./useProjectHoverComposition";

const ignore = () => undefined;
type Props = { data: ProjectPreviewData; onFinish: () => void };
/** A new source or saved composition starts hidden, including cache/revision changes. */
export function ProjectHoverPreview(props: Props) {
	const key = useMemo(
		() =>
			JSON.stringify([
				props.data.videoUrl,
				props.data.webcamUrl,
				props.data.revision,
				props.data.project.videoPath,
				props.data.project.editor,
			]),
		[props.data],
	);
	return <ProjectHoverPreviewSession key={key} {...props} />;
}

/** One muted five-second pass through the saved timeline using the editor renderer. */
function ProjectHoverPreviewSession({ data, onFinish }: Props) {
	const editor = useMemo(() => normalizeProjectEditor(data.project.editor), [data]);
	const annotationImages = useMemo(
		() =>
			editor.annotationRegions
				.filter(
					(annotation) =>
						annotation.type === "image" &&
						annotation.startMs < 5000 &&
						annotation.endMs > 0 &&
						annotation.content.startsWith("data:image"),
				)
				.map((annotation) => annotation.content),
		[editor],
	);
	const playback = useRef<VideoPlaybackRef>(null);
	const started = useRef(false);
	const stopping = useRef(false);
	const [rendererReady, setRendererReady] = useState(false);
	const host = useRef<HTMLDivElement>(null);
	const timelineTime = useRef(0);
	const finish = useCallback(() => {
		if (!stopping.current) onFinish();
	}, [onFinish]);
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
	const updateDimensions = useCallback(() => {
		const video = playback.current?.video;
		if (video?.videoWidth && video.videoHeight) {
			setSourceDimensions((current) =>
				current?.width === video.videoWidth && current.height === video.videoHeight
					? current
					: { width: video.videoWidth, height: video.videoHeight },
			);
		}
	}, []);
	const updateDuration = useCallback(
		(seconds: number) => {
			setDuration(seconds);
			updateDimensions();
		},
		[updateDimensions],
	);
	const [telemetry, setTelemetry] = useState<{
		loaded: boolean;
		samples: CursorTelemetryPoint[];
	}>({ loaded: false, samples: [] });
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
				if (active)
					setTelemetry({ loaded: true, samples: result.success ? result.samples : [] });
			})
			.catch(() => {
				if (active) setTelemetry({ loaded: true, samples: [] });
			});
		return () => {
			active = false;
		};
	}, [data.project.videoPath]);
	const updateTime = useCallback(
		(seconds: number) => {
			if (stopping.current) return;
			timelineTime.current = seconds;
			if (seconds >= 5) {
				playback.current?.pause();
				finish();
			} else setTime(seconds);
		},
		[finish],
	);
	const updatePlaying = useCallback(
		(value: boolean) => {
			if (stopping.current) return;
			setPlaying(value);
			if (value) started.current = true;
			else if (started.current) finish();
		},
		[finish],
	);
	const updateReady = useCallback(
		(ready: boolean) => {
			if (stopping.current) return;
			if (!ready && host.current) {
				host.current.style.opacity = "0";
				host.current.style.visibility = "hidden";
			}
			if (ready) updateDimensions();
			setRendererReady(ready);
		},
		[updateDimensions],
	);
	const frameReady = useProjectHoverComposition({
		data,
		playback,
		host,
		rendererReady,
		metadataReady: sourceDimensions !== null,
		telemetryReady: telemetry.loaded,
		annotationImages,
		annotations: editor.annotationRegions,
		aspectRatio,
		webcam: editor.webcam,
		timelineTime,
		onFailure: finish,
	});
	useEffect(() => {
		if (!frameReady || started.current || stopping.current) return;
		void playback.current?.play().catch(finish);
	}, [frameReady, finish]);
	useLayoutEffect(() => {
		stopping.current = false;
		// A stalled resource or unavailable GPU leaves the static thumbnail usable.
		const timeout = window.setTimeout(finish, 15000);
		const stopWhenHidden = () => {
			if (document.hidden) finish();
		};
		document.addEventListener("visibilitychange", stopWhenHidden);
		return () => {
			// Block stale play/resource promises before a new hover session can mount.
			stopping.current = true;
			clearTimeout(timeout);
			document.removeEventListener("visibilitychange", stopWhenHidden);
			playback.current?.pause();
		};
	}, [finish]);
	return (
		<div
			ref={host}
			data-project-hover-preview
			data-preview-ready={frameReady}
			className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden rounded-xl"
			style={{ opacity: frameReady ? 1 : 0, visibility: frameReady ? "visible" : "hidden" }}
			aria-hidden="true"
		>
			<div
				className="shrink-0"
				style={{ width: `${Math.max(100, (aspectRatio / (4 / 3)) * 100)}%` }}
			>
				<VideoPlayback
					{...editor}
					ref={playback}
					videoPath={data.videoUrl}
					webcamVideoPath={data.webcamUrl}
					clipRegions={clips}
					showShadow={editor.shadowIntensity > 0}
					currentTime={time}
					isPlaying={playing}
					volume={0}
					cursorTelemetry={telemetry.samples}
					selectedZoomId={null}
					onSelectZoom={ignore}
					onZoomFocusChange={ignore}
					onPreviewReadyChange={updateReady}
					onDurationChange={updateDuration}
					onTimeUpdate={updateTime}
					onPlayStateChange={updatePlaying}
					onError={finish}
				/>
			</div>
		</div>
	);
}
