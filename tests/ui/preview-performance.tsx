import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import VideoPlayback, { type VideoPlaybackRef } from "@/components/video-editor/VideoPlayback";
import {
	type AnnotationRegion,
	DEFAULT_ANNOTATION_STYLE,
	DEFAULT_AUTO_CAPTION_SETTINGS,
} from "@/components/video-editor/types";
import { I18nProvider } from "@/contexts/I18nContext";
import { FrameRenderer } from "@/lib/exporter/modernFrameRenderer";
import { getStatefulCursorAsset } from "@/components/video-editor/videoPlayback/cursorAssetRegistry";
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
const cursorTelemetry = [
	{ timeMs: 0, cx: 0.2, cy: 0.3 },
	{ timeMs: 6000, cx: 0.8, cy: 0.7 },
];
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
		performancePreview: {
			readonly api: VideoPlaybackRef | null;
			renders: number;
			invertedShadow: { preserved: number; altered: number; invertedBody: number };
		};
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
	const [showRedaction, setShowRedaction] = useState(false);
	const [suspended, setSuspended] = useState(false);
	const [volume, setVolume] = useState(1);
	const [parentRender, setParentRender] = useState(0);
	const [previewVersion, setPreviewVersion] = useState(0);
	const [exportStatus, setExportStatus] = useState("idle");
	const [clipMuted, setClipMuted] = useState(false);
	const previewClips = useMemo(
		() => (clipMuted ? clips.map((clip) => ({ ...clip, muted: true })) : clips),
		[clipMuted],
	);
	const runExportCycle = async () => {
		const video = playback.current?.video;
		if (!video) return;
		setSuspended(true);
		setExportStatus("running");
		await new Promise(requestAnimationFrame);
		const renderer = new FrameRenderer({
			width: 320,
			height: 180,
			wallpaper: "#111111",
			zoomRegions: zooms,
			showShadow: false,
			shadowIntensity: 0,
			backgroundBlur: 0,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			videoWidth: video.videoWidth,
			videoHeight: video.videoHeight,
			cursorTelemetry,
			showCursor: true,
			cursorStyle: "tahoe",
		});
		let frame: VideoFrame | null = null;
		try {
			await renderer.initialize();
			frame = new VideoFrame(video, { timestamp: video.currentTime * 1_000_000 });
			await renderer.renderFrame(
				frame,
				frame.timestamp,
				frame.timestamp,
				33333,
				frame.timestamp,
			);
			setExportStatus("done");
		} catch (error) {
			setExportStatus(String(error));
		} finally {
			frame?.close();
			renderer.destroy();
			setSuspended(false);
		}
	};
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
			const original = getStatefulCursorAsset("tahoe", "arrow").image;
			const inverted = getStatefulCursorAsset("tahoe-inverted", "arrow").image;
			const pixels = (image: HTMLImageElement) => {
				const canvas = document.createElement("canvas");
				canvas.width = image.naturalWidth;
				canvas.height = image.naturalHeight;
				const ctx = canvas.getContext("2d")!;
				ctx.drawImage(image, 0, 0);
				return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
			};
			const before = pixels(original),
				after = pixels(inverted);
			const invertedShadow = { preserved: 0, altered: 0, invertedBody: 0 };
			for (let i = 0; i < before.length; i += 4) {
				if (
					before[i + 3] > 0 &&
					before[i + 3] < 255 &&
					before[i] === 0 &&
					before[i + 1] === 0 &&
					before[i + 2] === 0
				) {
					if (
						after[i] === 0 &&
						after[i + 1] === 0 &&
						after[i + 2] === 0 &&
						after[i + 3] === before[i + 3]
					)
						invertedShadow.preserved++;
					else invertedShadow.altered++;
				}
				if (before[i + 3] === 255 && before[i] === 0 && after[i] === 255)
					invertedShadow.invertedBody++;
			}
			const probe = {
				invertedShadow,
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
				if (app.renderer?.runners?.postrender?.name)
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
		<main style={{ width: 800 }} data-parent-render={parentRender}>
			<button onClick={() => playback.current?.play()}>Play</button>
			<button onClick={() => playback.current?.pause()}>Pause</button>
			<button onClick={() => setPadding(padding === 20 ? 60 : 20)}>Change padding</button>
			<button onClick={() => setShowCursor(!showCursor)}>Toggle cursor</button>
			<button onClick={() => setShowAnnotation(!showAnnotation)}>Toggle annotation</button>
			<button onClick={() => setShowRedaction(!showRedaction)}>Toggle redaction</button>
			<button onClick={() => setSuspended(!suspended)}>Toggle suspension</button>
			<button onClick={() => setVolume(volume ? 0 : 1)}>Toggle mute</button>
			<button onClick={() => setClipMuted(!clipMuted)}>Toggle clip mute</button>
			<button onClick={() => setParentRender(parentRender + 1)}>Parent rerender</button>
			<button onClick={() => setPreviewVersion(previewVersion + 1)}>Remount preview</button>
			<button onClick={() => void runExportCycle()}>Run export cycle</button>
			<output data-export-status>{exportStatus}</output>
			<VideoPlayback
				key={previewVersion}
				ref={playback}
				videoPath="/tests/ui/fixtures/filmstrip.mp4"
				clipRegions={previewClips}
				currentTime={time}
				onTimeUpdate={(value) => setTime(value)}
				onDurationChange={noop}
				onPlayStateChange={(value) => setPlaying(value)}
				onError={(error) => onError(error)}
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
				cursorTelemetry={cursorTelemetry}
				annotationRegions={
					showRedaction
						? [
								...(showAnnotation ? [annotation] : empty),
								{
									...annotation,
									id: "privacy",
									type: "blur",
									startMs: 0,
									endMs: 120_000,
									position: { x: 0, y: 0 },
									size: { width: 100, height: 100 },
									blurColor: "#000000",
								},
							]
						: showAnnotation
							? [annotation]
							: empty
				}
				autoCaptions={captions}
				autoCaptionSettings={captionSettings}
				volume={volume}
				cursorIdleHide={{
					enabled: true,
					idleThresholdMs: 2000,
					fadeDelayMs: 500,
					fadeDurationMs: 300,
					movementTolerancePx: 2,
				}}
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
