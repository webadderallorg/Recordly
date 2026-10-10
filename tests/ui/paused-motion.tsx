import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import VideoPlayback, { type VideoPlaybackRef } from "@/components/video-editor/VideoPlayback";
import { I18nProvider } from "@/contexts/I18nContext";
import "@/index.css";
const cursor = new URLSearchParams(location.search).has("cursor");
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
		mode: "manual" as const,
	},
];
const telemetry = [
	{ timeMs: 0, cx: 0.1, cy: 0.5 },
	{ timeMs: 1000, cx: 0.9, cy: 0.5 },
	{ timeMs: 6000, cx: 0.9, cy: 0.5 },
];
function Preview() {
	const playback = useRef<VideoPlaybackRef>(null);
	const [playing, setPlaying] = useState(false);
	const [time, setTime] = useState(0.8);
	const [blur, setBlur] = useState(true);
	const [ready, setReady] = useState(false);
	return (
		<main style={{ width: 900 }} data-ready={ready}>
			<button onClick={() => playback.current?.play()}>Play</button>
			<button onClick={() => playback.current?.pause()}>Pause</button>
			<button onClick={() => setBlur((value) => !value)}>Toggle blur</button>
			<button onClick={() => playback.current?.seekTimeline(3)}>Seek elsewhere</button>
			<button onClick={() => playback.current?.seekTimeline(0.8)}>Seek back</button>
			<VideoPlayback
				ref={playback}
				videoPath="/tests/ui/fixtures/filmstrip.mp4"
				clipRegions={clips}
				currentTime={time}
				onTimeUpdate={setTime}
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
				zoomMotionBlur={!cursor && blur ? 1 : 0}
			/>
		</main>
	);
}
createRoot(document.getElementById("root")!).render(
	<I18nProvider>
		<Preview />
	</I18nProvider>,
);
