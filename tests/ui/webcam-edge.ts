import { DEFAULT_WEBCAM_OVERLAY } from "@/components/video-editor/types";
import { FrameRenderer as LegacyRenderer } from "@/lib/exporter/frameRenderer";
import { FrameRenderer as ModernRenderer } from "@/lib/exporter/modernFrameRenderer";
import type {
	ExportRendererProbe,
	LegacyRendererProbe,
	ModernRendererProbe,
} from "./exportRendererProbe";

export async function checkEdges() {
	const source = document.createElement("canvas");
	source.width = 400;
	source.height = 240;
	const sourceContext = source.getContext("2d")!;
	sourceContext.fillStyle = "#b4b4b4";
	sourceContext.fillRect(0, 0, 400, 240);
	// Asymmetric landmarks reveal crop/mirror offsets as well as dark edge seams.
	sourceContext.fillStyle = "#2563eb";
	sourceContext.fillRect(80, 60, 20, 120);
	sourceContext.fillStyle = "#ef4444";
	sourceContext.fillRect(260, 100, 40, 20);
	const results = [];
	for (const shape of ["circle", "squircle", "rectangle"] as const) {
		for (const cropped of [false, true]) {
			const images: ImageData[][] = [];
			for (const [name, Renderer] of [
				["modern", ModernRenderer],
				["legacy", LegacyRenderer],
			] as const) {
				const renderer = new Renderer({
					width: 640,
					height: 360,
					videoWidth: 640,
					videoHeight: 360,
					wallpaper: "#ffffff",
					zoomRegions: [],
					showShadow: false,
					shadowIntensity: 0,
					backgroundBlur: 0,
					showCursor: false,
					cropRegion: { x: 0, y: 0, width: 1, height: 1 },
					zoomMotionBlur: 0.5,
					preferredRenderBackend: "webgl",
					webcam: {
						...DEFAULT_WEBCAM_OVERLAY,
						enabled: true,
						shape,
						width: 51.7,
						height: 63.3,
						roundness: shape === "rectangle" ? 0 : 20,
						shadow: 0.2,
						mirror: cropped,
						cropRegion: cropped
							? { x: 0.1, y: 0.1, width: 0.8, height: 0.75 }
							: { x: 0, y: 0, width: 1, height: 1 },
					},
				}) as unknown as ExportRendererProbe;
				const modern = renderer as unknown as ModernRendererProbe;
				const legacy = renderer as unknown as LegacyRendererProbe;
				if (name === "modern") await modern.initialize();
				const media = name === "modern" ? modern.webcamMedia : legacy;
				const motion = name === "modern" ? modern.motion : legacy;
				media.webcamDecodedFrame = new VideoFrame(source, { timestamp: 0 });
				media.lastSyncedWebcamTime = 0;
				const output = document.createElement("canvas");
				output.width = 640;
				output.height = 360;
				const context = output.getContext("2d")!;
				const frames: ImageData[] = [];
				const draw = (scale: number, timeMs: number) => {
					motion.animationState.appliedScale = scale;
					context.fillStyle = "white";
					context.fillRect(0, 0, 640, 360);
					if (name === "modern") {
						modern.webcam.updateWebcamOverlay(0, timeMs);
						modern.scene.app.render();
						context.drawImage(renderer.getCanvas(), 0, 0);
					} else {
						legacy.webcamMotionTimeMs = timeMs;
						legacy.drawWebcamOverlay(context, 640, 360);
					}
					return context.getImageData(0, 0, 640, 360);
				};
				frames.push(draw(1, 0));
				frames.push(draw(1.03, 16));
				frames.push(draw(1, 32));
				frames.push(draw(1, 48));
				frames.push(draw(1, 200));
				renderer.config.zoomMotionBlur = 0;
				frames.push(draw(1, 216));
				images.push(frames);
				output.dataset.case = `${name}-${shape}-${cropped}`;
				document.body.append(output);
				renderer.destroy();
			}
			const difference = (first: ImageData, second: ImageData) => {
				let max = 0;
				for (let i = 0; i < first.data.length; i++)
					max = Math.max(max, Math.abs(first.data[i] - second.data[i]));
				return max;
			};
			results.push({
				shape,
				cropped,
				// Inside the rectangle's upper-left corner, above the circle's top edge.
				rectangleCorners:
					shape === "rectangle"
						? images.map((frames) =>
								Array.from(
									frames[0].data.slice(
										(127 * 640 + 448) * 4,
										(127 * 640 + 448) * 4 + 4,
									),
								),
							)
						: [],
				// Both production exporters must agree on every pixel, including the rim,
				// shadow, landmarks, and fractional-size edges throughout the shutter.
				exporterDifferences: images[0].map((frame, index) =>
					difference(frame, images[1][index]),
				),
				stationaryDifferences: images.map((frames) =>
					[3, 4, 5].map((index) => difference(frames[0], frames[index])),
				),
			});
		}
	}
	return results;
}
Object.assign(window, { checkEdges });
