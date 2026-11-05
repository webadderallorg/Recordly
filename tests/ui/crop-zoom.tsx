import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Point } from "pixi.js";
import VideoPlayback, { type VideoPlaybackRef } from "@/components/video-editor/VideoPlayback";
import type { ZoomRegion } from "@/components/video-editor/types";
import { I18nProvider } from "@/contexts/I18nContext";
import "@/index.css";

const params = new URLSearchParams(location.search);
const classic = params.has("classic");
const manual = params.has("manual");
const sourceCrop = { x: 0.5, y: 0.2, width: 0.5, height: 0.6 };
const sourceClick = { cx: 0.6, cy: 0.4 };
const focus = manual ? { cx: 0.35, cy: 0.65 } : sourceClick;
const zooms: ZoomRegion[] = [
	{ id: "zoom", startMs: 0, endMs: 4000, depth: 6, focus, mode: manual ? "manual" : "auto" },
];
const telemetry = [
	{ timeMs: 0, ...sourceClick },
	{ timeMs: 6000, ...sourceClick },
];
const clips = [{ id: "clip", startMs: 0, endMs: 6000, speed: 1 }];
const noop = () => undefined;

function Preview() {
	const playback = useRef<VideoPlaybackRef>(null);
	const [ready, setReady] = useState(false);
	const [time, setTime] = useState(2);
	const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
	return (
		<main
			style={{ width: 600 }}
			data-ready={ready}
			data-point-x={point?.x}
			data-point-y={point?.y}
		>
			<button
				onClick={() => {
					const api = playback.current;
					const video = api?.video;
					const sprite = api?.videoSprite;
					const screen = api?.app?.screen;
					if (!video || !sprite || !screen) return;
					const sourcePoint = manual
						? {
								cx: sourceCrop.x + focus.cx * sourceCrop.width,
								cy: sourceCrop.y + focus.cy * sourceCrop.height,
							}
						: sourceClick;
					const global = sprite.toGlobal(
						new Point(
							sourcePoint.cx * video.videoWidth,
							sourcePoint.cy * video.videoHeight,
						),
					);
					setPoint({ x: global.x / screen.width, y: global.y / screen.height });
				}}
			>
				Read click position
			</button>
			<VideoPlayback
				ref={playback}
				videoPath="/tests/ui/fixtures/filmstrip.mp4"
				clipRegions={clips}
				currentTime={time}
				onTimeUpdate={setTime}
				onDurationChange={noop}
				onPlayStateChange={noop}
				onError={(error) => {
					throw new Error(error);
				}}
				onPreviewReadyChange={setReady}
				zoomRegions={zooms}
				selectedZoomId={manual ? "zoom" : null}
				onSelectZoom={noop}
				onZoomFocusChange={noop}
				isPlaying={false}
				aspectRatio="native"
				wallpaper="#111111"
				showShadow={false}
				padding={0}
				cropRegion={sourceCrop}
				showCursor={false}
				cursorTelemetry={telemetry}
				zoomClassicMode={classic}
				zoomMotionBlur={0}
			/>
		</main>
	);
}
createRoot(document.getElementById("root")!).render(
	<I18nProvider>
		<Preview />
	</I18nProvider>,
);
