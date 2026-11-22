import { type AnnotationRegion, DEFAULT_ANNOTATION_STYLE } from "@/components/video-editor/types";
import { FrameRenderer as LegacyRenderer } from "@/lib/exporter/frameRenderer";
import { FrameRenderer as ModernRenderer } from "@/lib/exporter/modernFrameRenderer";
import { SourceRedactionCanvas } from "@/lib/exporter/sourceRedaction";

const width = 320;
const height = 180;
const cropRegion = { x: 0, y: 0, width: 1, height: 1 };
function annotation(overrides: Partial<AnnotationRegion> = {}): AnnotationRegion {
	return {
		id: "private",
		type: "blur",
		startMs: 0,
		endMs: 5000,
		content: "",
		position: { x: 25, y: (100 * 50) / height },
		size: { width: 25, height: (100 * 60) / height },
		blurIntensity: 20,
		style: DEFAULT_ANNOTATION_STYLE,
		zIndex: 1,
		...overrides,
	};
}
function makeSource() {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d")!;
	context.fillStyle = "rgb(128,128,128)";
	context.fillRect(0, 0, width, height);
	context.save();
	context.beginPath();
	context.rect(80, 50, 80, 60);
	context.clip();
	for (let y = 50; y < 110; y++) {
		context.fillStyle = y % 2 ? "white" : "black";
		context.fillRect(80, y, 80, 1);
	}
	context.fillStyle = "black";
	context.font = "bold 10px sans-serif";
	context.fillText("PRIVATE 123", 85, 80);
	context.restore();
	return canvas;
}
function pixels(canvas: HTMLCanvasElement) {
	const copy = document.createElement("canvas");
	copy.width = canvas.width;
	copy.height = canvas.height;
	const context = copy.getContext("2d")!;
	context.drawImage(canvas, 0, 0);
	return context.getImageData(0, 0, copy.width, copy.height).data;
}
function contrast(
	data: Uint8ClampedArray,
	xStart: number,
	xEnd: number,
	yStart: number,
	yEnd: number,
) {
	let maximum = 0;
	for (let x = xStart; x < xEnd; x++)
		for (let y = yStart; y < yEnd - 1; y++)
			maximum = Math.max(
				maximum,
				Math.abs(data[(y * width + x) * 4] - data[((y + 1) * width + x) * 4]),
			);
	return maximum;
}
function probe(data: Uint8ClampedArray, x: number, y: number) {
	return Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 4));
}
async function sourceChecks() {
	const source = makeSource();
	const owner = new SourceRedactionCanvas();
	const results = [];
	for (const blurColor of [undefined, "rgba(0,0,0,0.2)", "#00000000", "#000000"]) {
		const canvas = owner.render(source, {
			width,
			height,
			cropRegion,
			timeMs: 100,
			annotations: [annotation({ blurColor })],
		})!;
		const data = pixels(canvas);
		results.push({
			blurColor: blurColor ?? "blur",
			contrast: contrast(data, 100, 140, 60, 70),
			center: probe(data, 120, 65),
			unchanged: probe(data, 20, 20),
		});
	}
	const cropped = owner.render(source, {
		width,
		height,
		cropRegion: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
		timeMs: 100,
		annotations: [
			annotation({
				position: { x: 0, y: 0 },
				size: { width: 50, height: 50 },
				blurColor: "#000000",
			}),
		],
	})!;
	const croppedData = pixels(cropped);
	const sameCanvas =
		cropped ===
		owner.render(source, {
			width,
			height,
			cropRegion,
			timeMs: 100,
			annotations: [annotation()],
		});
	const edge = owner.render(source, {
		width,
		height,
		cropRegion,
		timeMs: 100,
		annotations: [
			annotation({ position: { x: -1.2, y: -1.5 }, size: { width: 10, height: 10 } }),
			annotation({ id: "outside", position: { x: 200, y: 200 } }),
		],
	})!;
	const edgeData = pixels(edge);
	const overlap = owner.render(source, {
		width,
		height,
		cropRegion,
		timeMs: 100,
		annotations: [
			annotation({ blurColor: "#000000" }),
			annotation({
				id: "top",
				blurColor: "#ffffff",
				zIndex: 2,
				position: { x: 35, y: (100 * 50) / height },
			}),
		],
	})!;
	const overlapData = pixels(overlap);
	owner.dispose();
	return {
		results,
		originalContrast: contrast(pixels(source), 100, 140, 60, 70),
		croppedInside: probe(croppedData, 90, 50),
		croppedOutside: probe(croppedData, 70, 50),
		sameCanvas,
		edge: probe(edgeData, 0, 0),
		overlap: probe(overlapData, 120, 65),
		retainedDimensions: [overlap.width, overlap.height],
	};
}

type Pose = {
	scale: number;
	appliedScale: number;
	focusX: number;
	focusY: number;
	progress: number;
	x: number;
	y: number;
};
type LegacyProbe = {
	animationState: Pose;
	updateAnimationState(timeMs: number): number;
	sourceRedaction: SourceRedactionCanvas;
};
async function movingChecks() {
	const source = makeSource();
	const results = [];
	for (const kind of ["modern", "legacy"] as const) {
		for (const mode of ["source-first", "post-only-control"] as const) {
			const config = {
				width,
				height,
				videoWidth: width,
				videoHeight: height,
				wallpaper: "#808080",
				zoomRegions: [],
				showShadow: false,
				shadowIntensity: 0,
				backgroundBlur: 0,
				cropRegion,
				showCursor: false,
				zoomMotionBlur: 0.7,
				preferredRenderBackend: "webgl" as const,
				annotationRegions: [annotation()],
			};
			const renderer =
				kind === "modern" ? new ModernRenderer(config) : new LegacyRenderer(config);
			const motion =
				kind === "modern"
					? (renderer as ModernRenderer).motion
					: (renderer as unknown as LegacyProbe);
			if (mode === "post-only-control") {
				if (kind === "modern")
					(renderer as ModernRenderer).annotations.redactSourceFrame = () => null;
				else (renderer as unknown as LegacyProbe).sourceRedaction.render = () => null;
			}
			let offset = 0;
			motion.updateAnimationState = () => {
				Object.assign(motion.animationState, {
					scale: 1,
					appliedScale: 1,
					focusX: 0.5,
					focusY: 0.5,
					progress: 1,
					x: offset,
					y: 0,
				});
				return 0;
			};
			let maximumTrailContrast = 0;
			let frames = 0;
			try {
				await renderer.initialize();
				for (const next of [
					0, 16, 32, 48, 64, 80, 96, 112, 128, 112, 96, 80, 64, 48, 32, 16, 0,
				]) {
					offset = next;
					const frame = new VideoFrame(source, { timestamp: frames * 16667 });
					try {
						await renderer.renderFrame(frame, frames * 16667, frames * 16667);
					} finally {
						frame.close();
					}
					if (frames > 0) {
						const data = pixels(renderer.getCanvas());
						for (let x = 0; x < width; x++) {
							if (x >= 78 + offset && x <= 162 + offset) continue;
							maximumTrailContrast = Math.max(
								maximumTrailContrast,
								contrast(data, x, x + 1, 60, 70),
							);
						}
					}
					frames++;
				}
			} finally {
				renderer.destroy();
			}
			results.push({ kind, mode, frames, maximumTrailContrast });
		}
	}
	return results;
}
async function solidMaskChecks() {
	const source = makeSource();
	const differentSecret = makeSource();
	const context = differentSecret.getContext("2d")!;
	context.save();
	context.beginPath();
	context.rect(80, 50, 80, 60);
	context.clip();
	context.fillStyle = "red";
	context.fillRect(80, 50, 80, 60);
	context.fillStyle = "blue";
	context.font = "bold 24px sans-serif";
	context.fillText("OTHER", 80, 85);
	context.restore();
	const original = pixels(source);
	const changed = pixels(differentSecret);
	const controlDifferent = original.some((value, index) => value !== changed[index]);
	const results = [];
	for (const kind of ["modern", "legacy"] as const) {
		const config = {
			width,
			height,
			videoWidth: width,
			videoHeight: height,
			wallpaper: "#808080",
			zoomRegions: [],
			showShadow: false,
			shadowIntensity: 0,
			backgroundBlur: 0,
			cropRegion,
			showCursor: false,
			zoomMotionBlur: 0.7,
			preferredRenderBackend: "webgl" as const,
			annotationRegions: [
				annotation({
					blurColor: "#000000",
				}),
			],
		};
		const create = () =>
			kind === "modern" ? new ModernRenderer(config) : new LegacyRenderer(config);
		const renderers = [create(), create()];
		let differingBytes = 0;
		let frames = 0;
		try {
			for (const renderer of renderers) await renderer.initialize();
			for (const offset of [0, 16, 48, 96, 128, 64, 16, 0]) {
				const images = [];
				for (const [index, renderer] of renderers.entries()) {
					const motion =
						kind === "modern"
							? (renderer as ModernRenderer).motion
							: (renderer as unknown as LegacyProbe);
					motion.updateAnimationState = () => {
						Object.assign(motion.animationState, {
							scale: 1,
							appliedScale: 1,
							focusX: 0.5,
							focusY: 0.5,
							progress: 1,
							x: offset,
							y: 0,
						});
						return 0;
					};
					const frame = new VideoFrame(index === 0 ? source : differentSecret, {
						timestamp: frames * 16667,
					});
					try {
						await renderer.renderFrame(frame, frames * 16667, frames * 16667);
					} finally {
						frame.close();
					}
					images.push(pixels(renderer.getCanvas()));
				}
				for (let index = 0; index < images[0].length; index++)
					if (images[0][index] !== images[1][index]) differingBytes++;
				frames++;
			}
		} finally {
			for (const renderer of renderers) renderer.destroy();
		}
		results.push({ kind, frames, differingBytes });
	}
	return { controlDifferent, results };
}
Object.assign(window, { sourceChecks, movingChecks, solidMaskChecks });
document.body.dataset.ready = "true";
