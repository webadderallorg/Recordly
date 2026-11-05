import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import VideoPlayback, { type VideoPlaybackRef } from "@/components/video-editor/VideoPlayback";
import {
	type AnnotationRegion,
	DEFAULT_ANNOTATION_STYLE,
	DEFAULT_AUTO_CAPTION_SETTINGS,
} from "@/components/video-editor/types";
import { I18nProvider } from "@/contexts/I18nContext";
import "@/index.css";

const captionSettings = { ...DEFAULT_AUTO_CAPTION_SETTINGS, enabled: true };
const captions = [
	{
		id: "caption",
		startMs: 0,
		endMs: 6000,
		text: "Follow every word",
		words: [
			{ text: "Follow", startMs: 0, endMs: 2000 },
			{ text: "every", startMs: 2000, endMs: 4000, leadingSpace: true },
			{ text: "word", startMs: 4000, endMs: 6000, leadingSpace: true },
		],
	},
];
const clips = Array.from({ length: 20 }, (_, index) => ({
	id: `clip-${index}`,
	startMs: index * 6000,
	endMs: (index + 1) * 6000,
	sourceStartMs: 0,
	speed: 1,
}));
const zooms = [
	{
		id: "zoom",
		startMs: 500,
		endMs: 4000,
		depth: 2 as const,
		focus: { cx: 0.65, cy: 0.45 },
		mode: "manual" as const,
	},
];
const empty: AnnotationRegion[] = [];
const noop = () => undefined;
const onError = (error: string) => {
	throw new Error(error);
};
const annotation: AnnotationRegion = {
	id: "text",
	type: "text",
	startMs: 0,
	endMs: 5000,
	content: "Example",
	position: { x: 20, y: 30 },
	size: { width: 30, height: 20 },
	style: { ...DEFAULT_ANNOTATION_STYLE },
	zIndex: 1,
};

declare global {
	interface Window {
		performancePreview: { readonly api: VideoPlaybackRef | null; renders: number };
	}
}

function Preview() {
	const playback = useRef<VideoPlaybackRef>(null);
	const [ready, setReady] = useState(false);
	const [time, setTime] = useState(1);
	const [playing, setPlaying] = useState(false);
	const [padding, setPadding] = useState(20);
	const [showCursor, setShowCursor] = useState(false);
	const [showAnnotation, setShowAnnotation] = useState(false);
	const [suspended, setSuspended] = useState(false);
	useEffect(() => {
		if (!ready) return;
		let pending = 0;
		let dispose = () => undefined;
		const install = () => {
			const app = playback.current?.app;
			if (!app || !playback.current?.videoSprite) {
				pending = requestAnimationFrame(install);
				return;
			}
			const probe = {
				get api() {
					return playback.current;
				},
				renders: 0,
			};
			window.performancePreview = probe;
			const listener = {
				postrender: () => {
					probe.renders++;
				},
			};
			app.renderer.runners.postrender.add(listener);
			dispose = () => {
				app.renderer.runners.postrender.remove(listener);
			};
		};
		install();
		return () => {
			cancelAnimationFrame(pending);
			dispose();
		};
	}, [ready]);
	return (
		<main style={{ width: 800 }}>
			<button onClick={() => playback.current?.play()}>Play</button>
			<button onClick={() => playback.current?.pause()}>Pause</button>
			<button onClick={() => setPadding(padding === 20 ? 60 : 20)}>Change padding</button>
			<button onClick={() => setShowCursor(!showCursor)}>Toggle cursor</button>
			<button onClick={() => setShowAnnotation(!showAnnotation)}>Toggle annotation</button>
			<button onClick={() => setSuspended(!suspended)}>Toggle suspension</button>
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
				zoomRegions={zooms}
				selectedZoomId={null}
				onSelectZoom={noop}
				onZoomFocusChange={noop}
				isPlaying={playing}
				aspectRatio="16:9"
				wallpaper="#111111"
				showShadow={false}
				padding={padding}
				showCursor={showCursor}
				annotationRegions={showAnnotation ? [annotation] : empty}
				autoCaptions={captions}
				autoCaptionSettings={captionSettings}
				suspendRendering={suspended}
			/>
		</main>
	);
}
createRoot(document.getElementById("root")!).render(
	<I18nProvider>
		<Preview />
	</I18nProvider>,
);
