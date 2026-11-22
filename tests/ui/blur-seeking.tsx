import { Point } from "pixi.js";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { type AnnotationRegion, DEFAULT_ANNOTATION_STYLE } from "@/components/video-editor/types";
import VideoPlayback, { type VideoPlaybackRef } from "@/components/video-editor/VideoPlayback";
import { I18nProvider } from "@/contexts/I18nContext";
import { renderAnnotations } from "@/lib/exporter/annotationRenderer";
// Discover export dependencies before testing seeks; late optimization reloads
// the development page and destroys its pending media operations.
import "@/lib/exporter/frameRenderer";
import "@/lib/exporter/modernFrameRenderer";
import "@/index.css";

declare global {
	interface Window {
		blurPreview?: {
			readonly api: VideoPlaybackRef | null;
			probe: {
				frames: number;
				maxError: number;
				detail: string;
				privateFrames: number;
				maxPrivatePixel: number;
				minPrivateAlpha: number;
				maxRawControl: number;
				motionFrames: number;
			};
			exportCorner: () => Promise<{ before: number; after: number }>;
			samplePrivacy: () => Promise<{
				pixel: number[];
				raw: number[];
				sourceIsCanvas: boolean;
			}>;
		};
	}
}

const noop = () => undefined;
const onError = (error: string) => {
	throw new Error(error);
};
const params = new URLSearchParams(location.search);
const crop = params.has("crop") ? { x: 0.2, y: 0.1, width: 0.7, height: 0.8 } : undefined;
const clips = params.has("repeat")
	? [
			{ id: "clip", startMs: 0, endMs: 3000, speed: 1 },
			{ id: "repeat", startMs: 3000, endMs: 6000, sourceStartMs: 0, speed: 1 },
		]
	: [{ id: "clip", startMs: 0, endMs: 6000, speed: 1 }];
const zooms = [
	{
		id: "zoom",
		startMs: 500,
		endMs: 4000,
		depth: 2 as const,
		focus: params.has("autoZoom") ? { cx: 0.5, cy: 0.5 } : { cx: 0.65, cy: 0.45 },
		mode: params.has("autoZoom") ? ("auto" as const) : ("manual" as const),
	},
];
const telemetry = params.has("autoZoom")
	? [
			{ timeMs: 0, cx: 0.1, cy: 0.5 },
			{ timeMs: 1000, cx: 0.9, cy: 0.5 },
			{ timeMs: 4000, cx: 0.9, cy: 0.5 },
			{ timeMs: 6000, cx: 0.5, cy: 0.5 },
		]
	: [];
const annotations: AnnotationRegion[] = [
	{
		id: "blur",
		type: "blur",
		startMs: 0,
		endMs: 4500,
		content: "",
		position: { x: 35, y: 30 },
		size: { width: 30, height: 25 },
		style: { ...DEFAULT_ANNOTATION_STYLE, borderRadius: 24 },
		zIndex: 1,
		blurIntensity: 20,
		blurColor: params.has("solid") ? "#000000" : undefined,
	},
];

function Preview() {
	const playback = useRef<VideoPlaybackRef>(null);
	const [ready, setReady] = useState(false);
	const [time, setTime] = useState(0.2);
	const [playing, setPlaying] = useState(false);
	const [selected, setSelected] = useState<string | null>(null);
	const [regions, setRegions] = useState(annotations);
	useEffect(() => {
		if (!ready) return;
		let request = 0;
		let dispose = () => undefined;
		const install = () => {
			const api = playback.current;
			if (!api?.app || !api.videoContainer) {
				request = requestAnimationFrame(install);
				return;
			}
			const probe = {
				frames: 0,
				maxError: 0,
				detail: "",
				privateFrames: 0,
				maxPrivatePixel: 0,
				minPrivateAlpha: 255,
				maxRawControl: 0,
				motionFrames: 0,
			};
			const pixelCanvas = document.createElement("canvas");
			pixelCanvas.width = pixelCanvas.height = 1;
			const pixelContext = pixelCanvas.getContext("2d", { willReadFrequently: true })!;
			const samplePixel = (source: CanvasImageSource, x: number, y: number) => {
				pixelContext.clearRect(0, 0, 1, 1);
				pixelContext.drawImage(source, x, y, 1, 1, 0, 0, 1, 1);
				return pixelContext.getImageData(0, 0, 1, 1).data;
			};
			const samplePrivacy = () => {
				const current = playback.current!;
				const sprite = current.videoSprite!;
				const video = current.video!;
				const source = crop ?? { x: 0, y: 0, width: 1, height: 1 };
				const centerX = (source.x + source.width * 0.5) * video.videoWidth;
				const centerY = (source.y + source.height * 0.425) * video.videoHeight;
				const point = sprite.toGlobal(new Point(centerX, centerY));
				const resolution = api.app!.renderer.resolution;
				return {
					pixel: Array.from(
						samplePixel(api.app!.canvas, point.x * resolution, point.y * resolution),
					),
					raw: Array.from(samplePixel(video, centerX, centerY)),
					sourceIsCanvas: sprite.texture.source.resource instanceof HTMLCanvasElement,
				};
			};
			const sample = () => {
				const current = playback.current!;
				const sprite = current.videoSprite;
				const element = document.querySelector('[data-annotation-id="blur"]');
				if (!sprite || !element || !current.isPlaying) return;
				const video = current.video!;
				const source = crop ?? { x: 0, y: 0, width: 1, height: 1 };
				const topLeft = sprite.toGlobal(
					new Point(
						(source.x + source.width * 0.35) * video.videoWidth,
						(source.y + source.height * 0.3) * video.videoHeight,
					),
				);
				const bottomRight = sprite.toGlobal(
					new Point(
						(source.x + source.width * 0.65) * video.videoWidth,
						(source.y + source.height * 0.55) * video.videoHeight,
					),
				);
				const canvas = api.app!.canvas.getBoundingClientRect();
				const actual = element.getBoundingClientRect();
				probe.frames++;
				const error = Math.max(
					Math.abs(actual.x - canvas.x - topLeft.x),
					Math.abs(actual.y - canvas.y - topLeft.y),
					Math.abs(actual.width - (bottomRight.x - topLeft.x)),
					Math.abs(actual.height - (bottomRight.y - topLeft.y)),
				);
				if (error > probe.maxError) {
					probe.maxError = error;
					probe.detail = JSON.stringify({
						actual: actual.toJSON(),
						topLeft,
						bottomRight,
						canvas: canvas.toJSON(),
						time: video.currentTime,
					});
				}
				if (params.has("solid")) {
					const { pixel, raw } = samplePrivacy();
					probe.privateFrames++;
					probe.maxPrivatePixel = Math.max(
						probe.maxPrivatePixel,
						pixel[0],
						pixel[1],
						pixel[2],
					);
					probe.minPrivateAlpha = Math.min(probe.minPrivateAlpha, pixel[3]);
					probe.maxRawControl = Math.max(probe.maxRawControl, raw[0], raw[1], raw[2]);
					const filters = current.videoContainer?.parent?.filters;
					if (
						Array.isArray(filters) &&
						filters.some((filter) => {
							const motion = filter as {
								strength?: number;
								velocity?: { x: number; y: number };
							};
							return (
								(motion.strength ?? 0) > 0 ||
								Math.hypot(motion.velocity?.x ?? 0, motion.velocity?.y ?? 0) > 0
							);
						})
					)
						probe.motionFrames++;
				}
			};
			Object.assign(window, {
				blurPreview: {
					get api() {
						return playback.current;
					},
					probe,
					samplePrivacy: () =>
						new Promise((resolve) => {
							requestAnimationFrame(() => {
								// A paused preview intentionally has no ticker callbacks.
								api.app!.render();
								resolve(samplePrivacy());
							});
						}),
					async exportCorner() {
						const canvas = document.createElement("canvas");
						canvas.width = 200;
						canvas.height = 100;
						const context = canvas.getContext("2d")!;
						for (let x = 0; x < canvas.width; x += 4) {
							context.fillStyle = x % 8 ? "black" : "white";
							context.fillRect(x, 0, 4, canvas.height);
						}
						const before = context.getImageData(71, 31, 1, 1).data[0];
						await renderAnnotations(context, annotations, 200, 100, 1000);
						return { before, after: context.getImageData(71, 31, 1, 1).data[0] };
					},
				},
			});
			// Pixel probes run after Pixi's render priority (-50), before browser compositing.
			api.app.ticker.add(sample, undefined, -60);
			dispose = () => {
				api.app?.ticker.remove(sample);
			};
		};
		install();
		return () => {
			cancelAnimationFrame(request);
			dispose();
		};
	}, [ready]);
	return (
		<main style={{ width: 800 }} data-ready={ready}>
			<button onClick={() => playback.current?.play()}>Play</button>
			<button onClick={() => playback.current?.pause()}>Pause</button>
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
				padding={params.has("edges") ? 100 : 20}
				borderRadius={params.has("edges") ? 12 : 0}
				showCursor={false}
				cursorTelemetry={telemetry}
				cropRegion={crop}
				zoomMotionBlur={params.has("motion") ? 1 : 0}
				annotationRegions={regions}
				selectedAnnotationId={selected}
				onSelectAnnotation={setSelected}
				onAnnotationPositionChange={(id, position) =>
					setRegions((current) =>
						current.map((region) =>
							region.id === id ? { ...region, position } : region,
						),
					)
				}
				onAnnotationSizeChange={(id, size) =>
					setRegions((current) =>
						current.map((region) => (region.id === id ? { ...region, size } : region)),
					)
				}
			/>
		</main>
	);
}
createRoot(document.getElementById("root")!).render(
	<I18nProvider>
		<Preview />
	</I18nProvider>,
);
