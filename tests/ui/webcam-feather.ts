import {
	DEFAULT_WEBCAM_OVERLAY,
	type WebcamOverlaySettings,
	type WebcamShape,
} from "@/components/video-editor/types";
import { FrameRenderer as LegacyRenderer } from "@/lib/exporter/frameRenderer";
import { FrameRenderer as ModernRenderer } from "@/lib/exporter/modernFrameRenderer";
import type {
	ExportRendererProbe,
	LegacyRendererProbe,
	ModernRendererProbe,
} from "./exportRendererProbe";

export async function featherChecks() {
	const source = document.createElement("canvas");
	source.width = source.height = 200;
	const sourceContext = source.getContext("2d")!;
	sourceContext.fillStyle = "white";
	sourceContext.fillRect(0, 0, 200, 200);
	for (let y = 80; y < 120; y += 4) {
		for (let x = 80; x < 120; x += 4) {
			sourceContext.fillStyle = (x + y) % 8 === 0 ? "black" : "white";
			sourceContext.fillRect(x, y, 4, 4);
		}
	}
	const results = [];
	for (const [name, Renderer] of [
		["modern", ModernRenderer],
		["legacy", LegacyRenderer],
	] as const) {
		const renderer = new Renderer({
			width: 640,
			height: 360,
			videoWidth: 640,
			videoHeight: 360,
			wallpaper: "#202020",
			zoomRegions: [],
			showShadow: false,
			shadowIntensity: 0,
			backgroundBlur: 0,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			webcam: {
				...DEFAULT_WEBCAM_OVERLAY,
				enabled: true,
				width: 50,
				height: 50,
				shadow: 0,
				roundness: 0,
			},
			zoomMotionBlur: 0,
			showCursor: false,
			preferredRenderBackend: "webgl",
		}) as unknown as ExportRendererProbe & { config: { webcam: WebcamOverlaySettings } };
		const modern = renderer as unknown as ModernRendererProbe;
		const legacy = renderer as unknown as LegacyRendererProbe;
		if (name === "modern") await modern.initialize();
		const frames = name === "modern" ? modern.webcamFrames : legacy;
		frames.webcamFrameCacheCanvas = source;
		frames.webcamFrameCacheCtx = source.getContext("2d");
		if (name === "legacy") legacy.webcamVideoElement = { readyState: 0 };
		const target = document.createElement("canvas");
		target.width = 640;
		target.height = 360;
		for (const shape of ["circle", "rectangle", "squircle"] as WebcamShape[]) {
			for (const frame of ["standard", "soft-blur"] as const) {
				renderer.config.webcam = { ...renderer.config.webcam, shape, previewFrame: frame };
				let canvas: HTMLCanvasElement;
				if (name === "modern") {
					modern.webcam.updateWebcamOverlay(0, 0);
					modern.scene.app.render();
					canvas = renderer.getCanvas();
				} else {
					const context = target.getContext("2d")!;
					context.fillStyle = "#202020";
					context.fillRect(0, 0, 640, 360);
					legacy.drawWebcamOverlay(context, 640, 360);
					canvas = target;
				}
				const copy = document.createElement("canvas");
				copy.width = 640;
				copy.height = 360;
				const context = copy.getContext("2d")!;
				context.drawImage(canvas, 0, 0);
				const pixel = (x: number, y: number) => context.getImageData(x, y, 1, 1).data[0];
				// The fixture's 180px camera occupies (452,172)–(632,352).
				const edges = [
					Array.from({ length: 40 }, (_, i) => pixel(542, 172 + i)),
					Array.from({ length: 40 }, (_, i) => pixel(631 - i, 262)),
					Array.from({ length: 40 }, (_, i) => pixel(542, 351 - i)),
					Array.from({ length: 40 }, (_, i) => pixel(452 + i, 262)),
				];
				results.push({
					name,
					shape,
					frame,
					edges,
					center: Array.from(context.getImageData(538, 258, 8, 8).data),
				});
				copy.dataset.export = `${name}-${shape}-${frame}`;
				document.body.append(copy);
			}
		}
		if (name === "legacy") legacy.webcamVideoElement = null;
		renderer.destroy();
	}
	return results;
}
Object.assign(window, { featherChecks });
