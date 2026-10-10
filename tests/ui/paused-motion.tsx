import { useCallback, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import VideoPlayback, { type VideoPlaybackRef } from "@/components/video-editor/VideoPlayback";
import { I18nProvider } from "@/contexts/I18nContext";
import "@/index.css";
const cursor = new URLSearchParams(location.search).has("cursor");
const autoZoom = new URLSearchParams(location.search).has("autoZoom");
const noop = () => undefined;
const onError = (error: string) => {
	throw new Error(error);
};
const clips = [{ id: "clip", startMs: 0, endMs: 6000, speed: 1 }];
const zooms = [
	{
		id: "zoom",
		startMs: 0,
		endMs: 4000,
		depth: 2 as const,
		focus: { cx: 0.5, cy: 0.5 },
		mode: autoZoom ? ("auto" as const) : ("manual" as const),
	},
];
const telemetry = [
	{ timeMs: 0, cx: 0.1, cy: 0.5 },
	{ timeMs: 1000, cx: 0.9, cy: 0.5 },
	{ timeMs: 3400, cx: 0.9, cy: 0.5 },
	{ timeMs: 3500, cx: 0.5, cy: 0.5 },
	{ timeMs: 6000, cx: 0.5, cy: 0.5 },
];
function Preview() {
	const playback = useRef<VideoPlaybackRef>(null);
	const stopAt = useRef<number | null>(null);
	const [playing, setPlaying] = useState(false);
	const [time, setTime] = useState(0.8);
	const [blur, setBlur] = useState(true);
	const [ready, setReady] = useState(false);
	const [cameraOffset, setCameraOffset] = useState<number | null>(null);
	const onTimeUpdate = useCallback((nextTime: number) => {
		setTime(nextTime);
		if (stopAt.current !== null && nextTime >= stopAt.current) {
			stopAt.current = null;
			playback.current?.pause();
		}
	}, []);
	return (
		<main
			style={{ width: autoZoom ? 400 : 900 }}
			data-ready={ready}
			data-camera-offset={cameraOffset}
		>
			<button onClick={() => playback.current?.play()}>Play</button>
			<button onClick={() => playback.current?.pause()}>Pause</button>
			<button onClick={() => setBlur((value) => !value)}>Toggle blur</button>
			<button onClick={() => playback.current?.seekTimeline(3)}>Seek elsewhere</button>
			<button onClick={() => playback.current?.seekTimeline(0.8)}>Seek back</button>
			<button onClick={() => playback.current?.seekTimeline(4.2)}>Seek zoom-out</button>
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
					stopAt.current = 4.35;
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
		</main>
	);
}
createRoot(document.getElementById("root")!).render(
	<I18nProvider>
		<Preview />
	</I18nProvider>,
);
