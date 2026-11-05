import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CURSOR_MOTION_PRESETS } from "@/components/video-editor/cursorMotionPresets";
import TimelineEditor from "@/components/video-editor/timeline/TimelineEditor";
import VideoPlayback, { type VideoPlaybackRef } from "@/components/video-editor/VideoPlayback";
import { getZoomRegionTiming } from "@/components/video-editor/videoPlayback/zoomRegionUtils";
import { I18nProvider } from "@/contexts/I18nContext";
import { ShortcutsProvider } from "@/contexts/ShortcutsContext";
import "@/index.css";
const cursor = new URLSearchParams(location.search).has("cursor");
const autoZoom = new URLSearchParams(location.search).has("autoZoom");
const timing = new URLSearchParams(location.search).has("timing");
const visualBounds = new URLSearchParams(location.search).has("visualBounds");
const focusEntry = new URLSearchParams(location.search).has("focusEntry");
const zoomDuration = Number(new URLSearchParams(location.search).get("zoomDuration")) || 3000;
const pan = new URLSearchParams(location.search).has("pan");
const shortPan = new URLSearchParams(location.search).has("shortPan");
const slowCamera = new URLSearchParams(location.search).has("slowCamera");
const panDepth = new URLSearchParams(location.search).get("panDepth");
const preset =
	CURSOR_MOTION_PRESETS[
		new URLSearchParams(location.search).has("smooth") ? "smooth" : "focused"
	];
const noop = () => undefined;
const onError = (error: string) => {
	throw new Error(error);
};
const clips = [{ id: "clip", startMs: 0, endMs: 6000, speed: 1 }];
const zooms = pan
	? [
			{
				id: "first",
				startMs: 0,
				endMs: 2000,
				depth: shortPan || panDepth === "wider" ? (3 as const) : (2 as const),
				focus: { cx: 0.35, cy: 0.5 },
				mode: "manual" as const,
			},
			{
				id: "next",
				startMs: shortPan ? 2695 : 3000,
				endMs: shortPan ? 3695 : 5000,
				depth: shortPan || panDepth === "deeper" ? (3 as const) : (2 as const),
				focus: { cx: 0.65, cy: 0.5 },
				mode: "manual" as const,
			},
		]
	: [
			{
				id: "zoom",
				startMs: timing ? 1000 : 0,
				endMs: timing ? 1000 + zoomDuration : 4000,
				depth: focusEntry ? (3 as const) : (2 as const),
				focus: { cx: 0.5, cy: 0.5 },
				mode: autoZoom || focusEntry ? ("auto" as const) : ("manual" as const),
			},
		];
const timingPhases = getZoomRegionTiming(zooms[0], preset);
const telemetry = focusEntry
	? [{ timeMs: 0, cx: 0.9, cy: 0.1 }]
	: [
			{ timeMs: 0, cx: 0.1, cy: 0.5 },
			{ timeMs: 1000, cx: 0.9, cy: 0.5 },
			{ timeMs: 3400, cx: 0.9, cy: 0.5 },
			{ timeMs: 3500, cx: 0.5, cy: 0.5 },
			{ timeMs: 6000, cx: 0.5, cy: 0.5 },
		];
function Preview() {
	const playback = useRef<VideoPlaybackRef>(null);
	const stopAt = useRef<number | null>(null);
	const main = useRef<HTMLElement>(null);
	const panSamples = useRef<Array<{ time: number; offset: number; scale: number }>>([]);
	const [playing, setPlaying] = useState(false);
	const [time, setTime] = useState(0.8);
	const [blur, setBlur] = useState(true);
	const [ready, setReady] = useState(false);
	const [cameraOffset, setCameraOffset] = useState<number | null>(null);
	const [cameraScale, setCameraScale] = useState<number | null>(null);
	const onTimeUpdate = useCallback((nextTime: number) => {
		setTime(nextTime);
		if (stopAt.current !== null && nextTime >= stopAt.current) {
			stopAt.current = null;
			playback.current?.pause();
		}
	}, []);
	useEffect(() => {
		if (!ready || !slowCamera) return;
		const ticker = playback.current?.app?.ticker;
		if (!ticker) return;
		const previous = ticker.maxFPS;
		ticker.maxFPS = 2;
		return () => {
			ticker.maxFPS = previous;
		};
	}, [ready]);
	useEffect(() => {
		if ((!pan && !visualBounds && !focusEntry) || !ready || !playing) return;
		const app = playback.current?.app;
		if (!app) return;
		const sample = () => {
			const video = main.current?.querySelector("video");
			const camera = playback.current?.videoContainer?.parent?.parent;
			if (!video || !camera) return;
			const frames = panSamples.current;
			if (frames.at(-1)?.time === video.currentTime) return;
			frames.push({
				time: video.currentTime,
				scale: camera.scale.x,
				offset: camera.x + (app.screen.width / 2) * (camera.scale.x - 1),
			});
			if (main.current) main.current.dataset.panSamples = JSON.stringify(frames);
		};
		// Observe composed camera poses after the playback ticker has integrated physics.
		app.ticker.add(sample, undefined, -100);
		return () => {
			app.ticker.remove(sample);
		};
	}, [ready, playing]);
	return (
		<main
			ref={main}
			style={{ width: autoZoom ? 400 : 900 }}
			data-ready={ready}
			data-camera-offset={cameraOffset}
			data-camera-scale={cameraScale}
		>
			<button onClick={() => playback.current?.play()}>Play</button>
			<button onClick={() => playback.current?.pause()}>Pause</button>
			<button onClick={() => setBlur((value) => !value)}>Toggle blur</button>
			<button onClick={() => playback.current?.seekTimeline(3)}>Seek elsewhere</button>
			<button onClick={() => playback.current?.seekTimeline(0.8)}>Seek back</button>
			<button onClick={() => playback.current?.seekTimeline(3.7)}>Seek zoom-out</button>
			{pan && (
				<>
					<button onClick={() => playback.current?.seekTimeline(1.5)}>
						Seek outgoing hold
					</button>
					<button onClick={() => playback.current?.seekTimeline(1.9)}>
						Seek outgoing end
					</button>
					<button onClick={() => playback.current?.seekTimeline(2.5)}>
						Seek pan midpoint
					</button>
					<button onClick={() => playback.current?.seekTimeline(zooms[1].startMs / 1000)}>
						Seek incoming start
					</button>
					<button
						onClick={() => {
							panSamples.current = [];
							stopAt.current = zooms[1].startMs / 1000 + 0.05;
							playback.current?.play();
						}}
					>
						Play across pan
					</button>
					<button
						onClick={() => {
							stopAt.current = 3.8;
							playback.current?.play();
						}}
					>
						Play through settling
					</button>
				</>
			)}
			{timing && (
				<>
					<button onClick={() => playback.current?.seekTimeline(1.1)}>
						Seek early entry
					</button>
					<button
						onClick={() =>
							playback.current?.seekTimeline((zooms[0].endMs - 100) / 1000)
						}
					>
						Seek last exit sample
					</button>
					<button
						onClick={() =>
							playback.current?.seekTimeline((timingPhases.zoomOutStart + 100) / 1000)
						}
					>
						Seek early exit
					</button>
					<button onClick={() => playback.current?.seekTimeline(1)}>
						Seek zoom start
					</button>
					<button
						onClick={() =>
							playback.current?.seekTimeline(timingPhases.zoomInEnd / 1000)
						}
					>
						Seek full zoom
					</button>
					<button
						onClick={() =>
							playback.current?.seekTimeline(
								(4000 + timingPhases.zoomOutStart) / 2000,
							)
						}
					>
						Seek exit midpoint
					</button>
					<button onClick={() => playback.current?.seekTimeline(4)}>Seek zoom end</button>
				</>
			)}
			<button
				onClick={() => {
					stopAt.current = 2;
					playback.current?.play();
				}}
			>
				Play to full zoom
			</button>
			<button
				onClick={() => {
					stopAt.current = timing ? 4.05 : 3.85;
					playback.current?.play();
				}}
			>
				Resume through zoom-out
			</button>
			<button
				onClick={() => {
					const camera = playback.current?.videoContainer?.parent?.parent;
					const width = playback.current?.app?.screen.width;
					if (camera && width) {
						setCameraOffset(camera.x + (width / 2) * (camera.scale.x - 1));
						setCameraScale(camera.scale.x);
					}
				}}
			>
				Read camera
			</button>
			<VideoPlayback
				ref={playback}
				videoPath="/tests/ui/fixtures/filmstrip.mp4"
				clipRegions={clips}
				currentTime={time}
				onTimeUpdate={onTimeUpdate}
				onDurationChange={noop}
				onPlayStateChange={setPlaying}
				onError={onError}
				onPreviewReadyChange={setReady}
				zoomRegions={cursor ? [] : zooms}
				{...(timing || pan
					? {
							zoomInDurationMs: preset.zoomInDurationMs,
							zoomOutDurationMs: preset.zoomOutDurationMs,
							connectZooms: pan,
						}
					: {})}
				selectedZoomId={null}
				onSelectZoom={noop}
				onZoomFocusChange={noop}
				isPlaying={playing}
				aspectRatio="16:9"
				wallpaper="#111111"
				showShadow={false}
				padding={20}
				showCursor={cursor}
				cursorStyle="dot"
				cursorTelemetry={telemetry}
				cursorMotionBlur={cursor && blur ? 1 : 0}
				zoomMotionBlur={!cursor && !autoZoom && blur ? 1 : 0}
			/>
			{visualBounds && (
				<ShortcutsProvider>
					<div style={{ height: 200 }}>
						<TimelineEditor
							videoDuration={6}
							currentTime={time}
							zoomPresentationOptions={preset}
							zoomRegions={zooms}
							clipRegions={clips}
							onZoomAdded={noop}
							onZoomSpanChange={noop}
							onZoomDelete={noop}
							selectedZoomId={null}
							onSelectZoom={noop}
						/>
					</div>
				</ShortcutsProvider>
			)}
		</main>
	);
}
createRoot(document.getElementById("root")!).render(
	<I18nProvider>
		<Preview />
	</I18nProvider>,
);
