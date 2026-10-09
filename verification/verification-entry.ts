/**
 * Visual verification harness for the camera work.
 *
 * Loaded by verification/index.html in a headless browser. It imports the ACTUAL
 * app modules (Vite resolves them exactly as the editor does), renders frames
 * with PixiJS, and returns both PNG data URLs and the measured positions of
 * registration marks found in the OUTPUT PIXELS.
 *
 * Measuring the output rather than the inputs is the point: it proves the
 * composed transform is actually visible, not merely that the math returned
 * the expected numbers.
 *
 * Run: node scripts/verify-camera-render.mjs
 */
import { Application, Container, Graphics } from "pixi.js";
import { resolveSceneZoomTarget } from "../src/components/video-editor/videoPlayback/sceneMotion";
import { applyCamera3DTransform, computeCamera3DTransform } from "../src/components/video-editor/videoPlayback/camera3d";
import { applyZoomTransform, createMotionBlurState } from "../src/components/video-editor/videoPlayback/zoomTransform";
import { createCursorFollowCameraState } from "../src/components/video-editor/videoPlayback/cursorFollowCamera";
import type { ZoomRegion } from "../src/components/video-editor/types";

const W = 960;
const H = 540;

/** Registration-mark positions in the untransformed scene. */
const MARK_POSITIONS: Array<[number, number]> = [
	[W / 2, H / 2],
	[40, 40],
	[W - 40, 40],
	[40, H - 40],
	[W - 40, H - 40],
];

interface Scene {
	label: string;
	depth: 1 | 2 | 3;
	focus: { cx: number; cy: number };
	move3d?: ZoomRegion["move3d"];
	times: number[];
}

const SCENES: Scene[] = [
	{ label: "neutral-outside-region", depth: 2, focus: { cx: 0.5, cy: 0.5 }, times: [5000] },
	{ label: "flat-zoom-entry", depth: 2, focus: { cx: 0.53, cy: 0.5 }, times: [200] },
	{ label: "flat-zoom-peak", depth: 2, focus: { cx: 0.53, cy: 0.5 }, times: [2600] },
	{ label: "tilt-right", depth: 2, focus: { cx: 0.53, cy: 0.5 }, move3d: { preset: "tilt-right", intensity: 1 }, times: [2600] },
	{ label: "tilt-left", depth: 2, focus: { cx: 0.53, cy: 0.5 }, move3d: { preset: "tilt-left", intensity: 1 }, times: [2600] },
	{ label: "tilt-up", depth: 2, focus: { cx: 0.5, cy: 0.5 }, move3d: { preset: "tilt-up", intensity: 1 }, times: [2600] },
	{ label: "tilt-right-half", depth: 2, focus: { cx: 0.53, cy: 0.5 }, move3d: { preset: "tilt-right", intensity: 0.5 }, times: [2600] },
];

function makeScene() {
	const root = new Container();
	const bg = new Graphics();
	bg.rect(0, 0, W, H).fill(0x0d1117);
	root.addChild(bg);

	// Repeating static rows: any scale or shear shows up immediately.
	for (let row = 0; row < 14; row += 1) {
		const y = 24 + row * 38;
		bg.rect(20, y, 240, 22).fill(row % 2 ? 0x1f6feb : 0x238636);
		bg.rect(280, y, 180 + ((row * 53) % 220), 22).fill(0x30363d);
		bg.rect(500 + ((row * 31) % 120), y, 300, 22).fill(0x21262d);
	}

	const field = new Graphics();
	field.roundRect(300, 210, 420, 120, 12).fill(0x161b22);
	field.roundRect(300, 210, 420, 120, 12).stroke({ width: 3, color: 0x58a6ff });
	field.rect(320, 240, 260, 16).fill(0x8b949e);
	field.rect(320, 272, 180, 16).fill(0x6e7681);
	root.addChild(field);

	const marks = new Graphics();
	for (const [cx, cy] of MARK_POSITIONS) {
		// Thick and long enough to survive a 1.5x resample, so the centroid
		// measurement sees them clearly.
		marks.moveTo(cx - 26, cy).lineTo(cx + 26, cy);
		marks.moveTo(cx, cy - 26).lineTo(cx, cy + 26);
		marks.stroke({ width: 6, color: 0xff7b72 });
	}
	root.addChild(marks);

	return root;
}

/**
 * Measure the framebuffer directly.
 *
 * Two details matter here:
 *
 * 1. gl.readPixels, not canvas.toDataURL + <img>. The data-URL path is async
 *    and races Pixi's texture upload, which silently yields the previous
 *    frame's geometry.
 * 2. A whole-frame statistic, not a local search. At a 1.5x zoom the corner
 *    registration marks leave the viewport entirely, so a bounded search
 *    around their original position finds nothing and silently reports its
 *    starting point. The red-pixel centroid is immune to that: it measures
 *    wherever the marks actually ended up, or splits across both edges.
 */
function measureFrame(app: any) {
	const gl = app.renderer.gl;
	const pixels = new Uint8Array(W * H * 4);
	gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

	let count = 0;
	let sumX = 0;
	let sumY = 0;
	let minX = W;
	let maxX = 0;
	let minY = H;
	let maxY = 0;
	let checksum = 0;

	for (let y = 0; y < H; y += 1) {
		// readPixels origin is bottom-left; convert to top-left screen coords.
		const yTop = H - 1 - y;
		for (let x = 0; x < W; x += 1) {
			const i = (y * W + x) * 4;
			const r = pixels[i];
			const g = pixels[i + 1];
			const b = pixels[i + 2];
			// Marks are #ff7b72; nothing else in the scene is red-dominant.
			if (r > 140 && g < 140 && b < 140 && r - g > 60) {
				count += 1;
				sumX += x;
				sumY += yTop;
				if (x < minX) minX = x;
				if (x > maxX) maxX = x;
				if (yTop < minY) minY = yTop;
				if (yTop > maxY) maxY = yTop;
			}
			checksum = (checksum + r + ((g << 8) | (b << 16))) >>> 0;
		}
	}

	// Ruler pass: measure the magenta OUTLINE as a quad.
	//
	// For each scanline we record the leftmost and rightmost magenta pixel; the
	// outline's two vertical edges then appear as the extreme left/right
	// columns over the full height. A pure scale moves both edges by the same
	// amount (so they stay parallel and the width scales). A shear moves them by
	// DIFFERENT amounts, which is what makes the quad's sides non-parallel —
	// the definitive signature of a projective tilt.
	let magenta = 0;
	const colLeft = new Map<number, number>(); // x -> topmost y
	const colRight = new Map<number, number>(); // x -> topmost y
	let quadMinX = Number.MAX_SAFE_INTEGER;
	let quadMaxX = -1;
	let quadMinY = Number.MAX_SAFE_INTEGER;
	let quadMaxY = -1;
	// leftmost magenta x on the topmost and bottommost rows: their difference is
	// the probe's left-edge slant, which is non-zero ONLY under a shear.
	let topRowFirst = -1;
	let bottomRowFirst = -1;

	for (let y = 0; y < H; y += 1) {
		const yTop = y;
		let first = -1;
		let last = -1;
		for (let x = 0; x < W; x += 1) {
			const i = ((H - 1 - y) * W + x) * 4;
			const r = pixels[i];
			const g = pixels[i + 1];
			const b = pixels[i + 2];
			// #ff00ff on a dark scene: red and blue high, green low.
			if (r > 110 && b > 110 && g < 110 && r - g > 50 && b - g > 50) {
				magenta += 1;
				if (first < 0) first = x;
				last = x;
				if (!colLeft.has(x)) colLeft.set(x, yTop);
				if (!colRight.has(x)) colRight.set(x, yTop);
			}
		}
		if (first < 0) continue;
		if (first < quadMinX) quadMinX = first;
		if (last > quadMaxX) quadMaxX = last;
		if (yTop < quadMinY) {
			quadMinY = yTop;
			topRowFirst = first;
		}
		if (yTop > quadMaxY) {
			quadMaxY = yTop;
			bottomRowFirst = first;
		}
	}

	// Left edge = the x whose topmost occurrence is highest (top-left corner),
	// and likewise for the right edge; their top/bottom pairs give the quad.
	let leftEdgeX = -1;
	let rightEdgeX = -1;
	let leftEdgeTop = Number.MAX_SAFE_INTEGER;
	let rightEdgeTop = Number.MAX_SAFE_INTEGER;
	for (const [x, yTop] of colLeft) {
		if (yTop < leftEdgeTop) {
			leftEdgeTop = yTop;
			leftEdgeX = x;
		}
	}
	for (const [x, yTop] of colRight) {
		if (yTop < rightEdgeTop) {
			rightEdgeTop = yTop;
			rightEdgeX = x;
		}
	}
	let leftEdgeBottom = -1;
	let rightEdgeBottom = -1;
	for (const [x, yTop] of colLeft) {
		if (x === leftEdgeX && yTop > leftEdgeBottom) leftEdgeBottom = yTop;
	}
	for (const [x, yTop] of colRight) {
		if (x === rightEdgeX && yTop > rightEdgeBottom) rightEdgeBottom = yTop;
	}

	const ruler =
		magenta > 0 && leftEdgeX >= 0 && rightEdgeX >= 0
			? {
					left: quadMinX,
					right: quadMaxX,
					top: quadMinY,
					bottom: quadMaxY,
					width: quadMaxX - quadMinX,
					height: quadMaxY - quadMinY,
					leftEdgeX,
					rightEdgeX,
					leftEdgeTop,
					leftEdgeBottom,
					rightEdgeTop,
					rightEdgeBottom,
					// Shear signature: the left edge's horizontal slant from top to
					// bottom. A pure scale leaves this at 0; skewX makes it non-zero,
					// and the sign tells you which way the frame turned.
					edgeSkewY: bottomRowFirst - topRowFirst,
					rightEdgeSlantY: null,
					topRowFirst,
					bottomRowFirst,
					pixels: magenta,
				}
			: null;

	return {
		redCount: count,
		centroidX: count > 0 ? sumX / count : -1,
		centroidY: count > 0 ? sumY / count : -1,
		bbox: { minX, maxX, minY, maxY },
		ruler,
		checksum,
	};
}

/**
 * Build the ruler as its own layer.
 *
 * The ruler must be a SIBLING of the camera, not a child of it: it then sits
 * outside the zoom transform and measures only the tilt. Putting it inside the
 * camera mixes magnification with shear in one number, and it also drifts out
 * of frame at high zoom.
 */
function makeRuler() {
	const g = new Graphics();
	// A box OUTLINE, not a bar. A shear displaces x as a function of y (skewX)
	// and y as a function of x (skewY). A wide flat bar is nearly blind to
	// skewX because it only spans a few pixels of y; an outline with real
	// height makes both shears directly measurable by comparing its top edge to
	// its bottom edge (and its left edge to its right edge).
	g.rect(360, 90, 240, 360).stroke({ width: 6, color: 0xff00ff });
	return g;
}

export async function run(): Promise<any[]> {
	const app = new Application();
	await app.init({ width: W, height: H, background: 0x000000, antialias: true });

	const out: any[] = [];

	for (const scene of SCENES) {
		const stage = new Container();
		const tilt = new Container();
		const camera = new Container();
		stage.addChild(tilt);
		tilt.addChild(camera);
		camera.addChild(makeScene());
		// Ruler is a child of the TILT container but NOT of the camera, so it is
		// sheared by the 3D transform while staying immune to the zoom.
		tilt.addChild(makeRuler());
		app.stage.addChild(stage);

		for (const timeMs of scene.times) {
			const region: ZoomRegion = {
				id: "z",
				startMs: 0,
				endMs: 4000,
				depth: scene.depth,
				focus: scene.focus,
				mode: "manual",
				...(scene.move3d ? { move3d: scene.move3d } : {}),
			};

			// The real shared resolver, identical to preview and both exporters.
			const target = resolveSceneZoomTarget({
				zoomRegions: [region],
				timeMs,
				connectZooms: false,
				zoomClassicMode: false,
				cursorFollowCamera: createCursorFollowCameraState(),
			});

			const r3 = target.move3d;
			const tiltState =
				r3.rotateX === 0 && r3.rotateY === 0
					? { rotateX: 0, rotateY: 0, perspective: 0 }
					: {
							rotateY: r3.rotateY * target.progress,
							rotateX: r3.rotateX * target.progress,
							perspective: r3.perspective,
						};
			applyCamera3DTransform(tilt, tiltState, { width: W, height: H });

			applyZoomTransform({
				cameraContainer: camera,
				zoomBlurFilter: null,
				motionBlurFilter: null,
				stageSize: { width: W, height: H },
				baseMask: { x: 0, y: 0, width: W, height: H },
				zoomScale: target.scale,
				zoomProgress: target.progress,
				focusX: target.focus.cx,
				focusY: target.focus.cy,
				isPlaying: true,
				motionBlurAmount: 0,
				transformOverride: {
					scale: 1 + (target.scale - 1) * target.progress,
					x: (W / 2 - target.focus.cx * W * target.scale) * target.progress,
					y: (H / 2 - target.focus.cy * H * target.scale) * target.progress,
				},
				motionBlurState: createMotionBlurState(),
				frameTimeMs: timeMs,
			});

			app.renderer.render(app.stage);
			const url = (app.canvas as HTMLCanvasElement).toDataURL("image/png");

			out.push({
				label: `${scene.label} @${timeMs}ms`,
				url,
				scale: target.scale,
				progress: target.progress,
				move3d: r3,
				skew: computeCamera3DTransform(tiltState, { width: W, height: H }),
				measure: measureFrame(app),
			});
		}

		app.stage.removeChild(stage);
		stage.destroy({ children: true });
	}

	app.destroy(true);
	return out;
}

// Expose for the Node driver to await.
(window as any).__runVerification = run;
(window as any).__verifyReady = true;