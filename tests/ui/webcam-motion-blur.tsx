import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { DEFAULT_WEBCAM_OVERLAY, type ZoomRegion } from "@/components/video-editor/types";
import VideoPlayback, { type VideoPlaybackRef } from "@/components/video-editor/VideoPlayback";
import { WebcamMotionBlur } from "@/components/video-editor/webcamMotionBlur";
import { I18nProvider } from "@/contexts/I18nContext";
import { FrameRenderer as LegacyRenderer } from "@/lib/exporter/frameRenderer";
import { FrameRenderer as ModernRenderer } from "@/lib/exporter/modernFrameRenderer";
import type {
	ExportRendererProbe,
	LegacyRendererProbe,
	ModernRendererProbe,
} from "./exportRendererProbe";
import "@/index.css";

const clips = [{ id: "clip", startMs: 0, endMs: 6000, speed: 1 }];
const zooms: ZoomRegion[] = [
	{
		id: "zoom",
		startMs: 1200,
		endMs: 3000,
		depth: 2,
		focus: { cx: 0.5, cy: 0.5 },
		mode: "manual",
	},
];
const webcam = {
	...DEFAULT_WEBCAM_OVERLAY,
	enabled: true,
	width: 50,
	height: 50,
	shadow: 0,
	reactToZoom: true,
};
const noop = () => undefined;
const fail = (error: string) => {
	throw new Error(error);
};

function Preview() {
	const playback = useRef<VideoPlaybackRef>(null);
	const [time, setTime] = useState(0);
	const [ready, setReady] = useState(false);
	const [playing, setPlaying] = useState(false);
	const [portrait, setPortrait] = useState(false);
	return (
		<main style={{ width: portrait ? 160 : 640 }} data-ready={ready} data-time={time}>
			<button onClick={() => setPortrait(true)}>Portrait</button>
			<button onClick={() => void playback.current?.play()}>Play</button>
			<button onClick={() => playback.current?.pause()}>Pause</button>
			<VideoPlayback
				ref={playback}
				videoPath="/tests/ui/fixtures/filmstrip.mp4"
				webcamVideoPath="/tests/ui/fixtures/filmstrip.mp4"
				webcam={webcam}
				clipRegions={clips}
				currentTime={time}
				onTimeUpdate={setTime}
				onDurationChange={noop}
				onPlayStateChange={setPlaying}
				onPreviewReadyChange={setReady}
				onError={fail}
				zoomRegions={zooms}
				selectedZoomId={null}
				onSelectZoom={noop}
				onZoomFocusChange={noop}
				isPlaying={playing}
				aspectRatio={portrait ? "9:16" : "16:9"}
				wallpaper="#222222"
				showShadow={false}
				padding={0}
				showCursor={false}
				zoomMotionBlur={0.5}
				zoomInDurationMs={600}
				zoomOutDurationMs={600}
			/>
		</main>
	);
}

function snapshot(canvas: HTMLCanvasElement) {
	const copy = document.createElement("canvas");
	copy.width = canvas.width;
	copy.height = canvas.height;
	copy.getContext("2d")!.drawImage(canvas, 0, 0);
	const pixels = copy.getContext("2d")!.getImageData(0, 0, copy.width, copy.height).data;
	let partial = 0;
	for (let i = 3; i < pixels.length; i += 4)
		if (
			pixels[i] > 5 &&
			(pixels[i] < 245 ||
				(pixels[i - 3] > 5 && pixels[i - 3] < 250 && Math.abs(pixels[i - 3] - 34) > 2))
		)
			partial++;
	return {
		partial,
		canvas: copy,
		shadowProbe: Array.from(
			pixels.slice((356 * copy.width + 542) * 4, (356 * copy.width + 542) * 4 + 4),
		),
	};
}

export async function exportChecks(shadow = 0, nearStill = false) {
	const source = document.createElement("canvas");
	source.width = source.height = 200;
	const ctx = source.getContext("2d")!;
	ctx.fillStyle = "white";
	ctx.fillRect(0, 0, 200, 200);
	ctx.fillStyle = "black";
	ctx.fillRect(85, 0, 30, 200);
	ctx.fillRect(0, 85, 200, 30);
	const config = {
		width: 640,
		height: 360,
		videoWidth: 640,
		videoHeight: 360,
		wallpaper: "#222222",
		zoomRegions: [],
		showShadow: false,
		shadowIntensity: 0,
		backgroundBlur: 0,
		cropRegion: { x: 0, y: 0, width: 1, height: 1 },
		webcam: { ...webcam, shadow },
		zoomMotionBlur: 0.5,
		showCursor: false,
		preferredRenderBackend: "webgl" as const,
	};
	const results = [];
	for (const [name, Renderer] of [
		["modern", ModernRenderer],
		["legacy", LegacyRenderer],
	] as const) {
		// Exercise the actual export overlay methods with a cached decoded frame.
		const renderer = new Renderer({ ...config }) as unknown as ExportRendererProbe;
		const modern = renderer as unknown as ModernRendererProbe;
		const legacy = renderer as unknown as LegacyRendererProbe;
		if (name === "modern") await modern.initialize();
		const webcamFrames = name === "modern" ? modern.webcamFrames : legacy;
		const motion = name === "modern" ? modern.motion : legacy;
		webcamFrames.webcamFrameCacheCanvas = source;
		webcamFrames.webcamFrameCacheCtx = source.getContext("2d");
		if (name === "legacy") legacy.webcamVideoElement = { readyState: 0 };
		const target = document.createElement("canvas");
		target.width = 640;
		target.height = 360;
		let timeMs = 0;
		const draw = (scale: number) => {
			motion.animationState.appliedScale = scale;
			timeMs += 1000 / 60;
			if (name === "modern") {
				modern.webcam.updateWebcamOverlay(0, timeMs);
				modern.scene.app.render();
				return snapshot(renderer.getCanvas());
			}
			legacy.webcamMotionTimeMs = timeMs;
			const context = target.getContext("2d")!;
			context.clearRect(0, 0, 640, 360);
			legacy.drawWebcamOverlay(context, 640, 360);
			return snapshot(target);
		};
		const still = draw(1);
		const shrink = draw(nearStill ? 1.001 : 1.1);
		const grow = draw(1);
		const stopped = draw(1);
		let settled = stopped;
		for (let frame = 0; frame < 8; frame++) settled = draw(1);
		renderer.config.zoomMotionBlur = 0;
		const disabled = draw(1.1);
		for (const [state, shot] of [
			["still", still],
			["shrinking", shrink],
			["growing", grow],
			["settled", settled],
		] as const) {
			shot.canvas.dataset.export = `${name}-${state}`;
			document.body.append(shot.canvas);
		}
		const movingPixels = grow.canvas.getContext("2d")!.getImageData(0, 0, 640, 360).data;
		const settledPixels = settled.canvas.getContext("2d")!.getImageData(0, 0, 640, 360).data;
		let maxShadowDifference = 0;
		for (let y = 40; y < 360; y++) {
			for (let x = 320; x < 640; x++) {
				// Exclude only the circular camera and its antialiased edge, not the surrounding shadow.
				if (Math.hypot(x - 542, y - 262) <= 93) continue;
				const index = (y * 640 + x) * 4 + (name === "modern" ? 0 : 3);
				maxShadowDifference = Math.max(
					maxShadowDifference,
					Math.abs(movingPixels[index] - settledPixels[index]),
				);
			}
		}
		const stillContext = still.canvas.getContext("2d")!;
		results.push({
			circleShoulder: Array.from(stillContext.getImageData(475, 195, 1, 1).data),
			circleCenter: Array.from(stillContext.getImageData(542, 262, 1, 1).data),
			name,
			maxShadowDifference,
			shadowMoving: grow.shadowProbe,
			shadowSettled: settled.shadowProbe,
			still: still.partial,
			stopped: stopped.partial,
			shrinking: shrink.partial,
			growing: grow.partial,
			settled: settled.partial,
			disabled: disabled.partial,
		});
		if (name === "legacy") legacy.webcamVideoElement = null;
		renderer.destroy();
	}
	return results;
}
function shadowBoundaryChecks() {
	const source = document.createElement("canvas");
	source.width = source.height = 200;
	const context = source.getContext("2d")!;
	context.fillStyle = "white";
	context.fillRect(0, 0, 200, 200);
	const renderer = new WebcamMotionBlur();
	const sizes = [200, 198, 197.99, 197.5, 197.49, 197, 196.99, 196.5, 196.49];
	const active = sizes.map(
		(size, i) =>
			!!renderer.render({
				layout: {
					x: 400 - size,
					y: 400 - size,
					width: size,
					height: size,
					radius: size / 2,
				},
				// A zoom can advance between two display ticks of the same video frame.
				timeMs: (i > 1 ? i - 1 : i) * 16,
				playing: true,
				amount: 0.5,
				source,
				sourceWidth: 200,
				sourceHeight: 200,
				mirror: false,
				shadow: 0.2,
				shape: "circle",
			}),
	);
	let settled = true;
	for (let i = sizes.length; i < 25; i++)
		settled = !!renderer.render({
			layout: { x: 203.51, y: 203.51, width: 196.49, height: 196.49, radius: 196.49 / 2 },
			timeMs: i * 16,
			playing: true,
			amount: 0.5,
			source,
			sourceWidth: 200,
			sourceHeight: 200,
			mirror: false,
			shadow: 0.2,
			shape: "circle",
		});
	renderer.destroy();
	return { active, settled };
}
Object.assign(window, { exportChecks, shadowBoundaryChecks });
createRoot(document.getElementById("root")!).render(
	<I18nProvider>
		<Preview />
	</I18nProvider>,
);
