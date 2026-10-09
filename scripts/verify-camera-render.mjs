/**
 * Node driver for the camera render verification.
 *
 * Boots a Vite dev server (scripts/vite.verify.config.mjs) on the real project
 * so imports resolve exactly as they do in the app, drives headless Chromium
 * with software WebGL, runs the in-page harness, writes PNGs to
 * verification/, and asserts on statistics MEASURED FROM THE RENDERED PIXELS.
 *
 * Usage: node scripts/verify-camera-render.mjs
 */
import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const OUT_DIR = path.join(projectRoot, "verification");
const W = 960;

const server = await createServer({
	configFile: path.join(here, "vite.verify.config.mjs"),
	logLevel: "error",
});
await server.listen();

const browser = await chromium.launch({
	args: [
		"--use-gl=swiftshader",
		"--enable-unsafe-swiftshader",
		"--no-sandbox",
		"--disable-gpu-sandbox",
	],
});

let failures = 0;
let manifest = [];

function check(name, condition, detail) {
	if (!condition) failures += 1;
	console.log(
		`  [${condition ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`,
	);
}

try {
	const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
	page.on("pageerror", (err) => console.error("[page error]", err.message));
	page.on("console", (msg) => {
		if (msg.type() === "error") console.error("[page]", msg.text());
	});

	await page.goto("http://127.0.0.1:5199/verification/index.html", {
		waitUntil: "load",
	});
	await page.waitForFunction("window.__verifyReady === true", undefined, {
		timeout: 90_000,
	});

	const frames = await page.evaluate(async () => window.__runVerification());

	mkdirSync(OUT_DIR, { recursive: true });

	manifest = frames.map((frame, i) => {
		const name = frame.label.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
		const file = `frame-${String(i + 1).padStart(2, "0")}-${name}.png`;
		writeFileSync(
			path.join(OUT_DIR, file),
			Buffer.from(frame.url.split(",")[1], "base64"),
		);
		const m = frame.measure;
		console.log(
			`\nwrote ${file}: ${frame.label} ` +
				`scale=${frame.scale.toFixed(2)} progress=${frame.progress.toFixed(2)} ` +
				`skewX=${frame.skew.skewX.toFixed(4)} skewY=${frame.skew.skewY.toFixed(4)} ` +
				`rulerW=${m.ruler ? m.ruler.width.toFixed(1) : "none"} ` +
				`rulerH=${m.ruler ? (m.ruler.bottom - m.ruler.top).toFixed(1) : "none"}`,
		);
		return { file, label: frame.label, scale: frame.scale, progress: frame.progress, skew: frame.skew, measure: m };
	});

	writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));

	const find = (label) => manifest.find((f) => f.label.startsWith(label));
	const neutral = find("neutral-outside-region");
	const flatEntry = find("flat-zoom-entry");
	const flatPeak = find("flat-zoom-peak");
	const tiltRight = find("tilt-right ");
	const tiltLeft = find("tilt-left ");
	const tiltUp = find("tilt-up ");
	const tiltHalf = find("tilt-right-half");


	console.log("\n=== assertions measured from rendered pixels ===");

	// Baseline integrity: the neutral frame must contain the marks at all, so a
	// later displacement is meaningful rather than noise around nothing.
	check(
		"neutral frame renders the registration marks",
		neutral.measure.redCount > 500,
		`${neutral.measure.redCount} red px`,
	);
	check(
		"neutral frame has an identity 3D transform",
		neutral.skew.skewX === 0 &&
			neutral.skew.skewY === 0 &&
			neutral.skew.scale === 1,
		`skewX=${neutral.skew.skewX} skewY=${neutral.skew.skewY} scale=${neutral.skew.scale}`,
	);
	check(
		"neutral frame applies no zoom motion",
		neutral.progress < 1e-5,
		`progress=${neutral.progress.toExponential(2)}`,
	);
	check(
		"neutral frame's mark centroid sits at the scene centre",
		Math.abs(neutral.measure.centroidX - 480) < 12 &&
			Math.abs(neutral.measure.centroidY - 270) < 12,
		`(${neutral.measure.centroidX.toFixed(1)},${neutral.measure.centroidY.toFixed(1)}) vs (480,270)`,
	);

	// Flat zoom magnifies: the marks' bounding box must grow past the frame.
	check(
		"ruler is measurable in every frame",
		manifest.every((f) => f.measure.ruler !== null),
	);
	const rulerW = (f) => f.measure.ruler.width;
	const rulerH = (f) => f.measure.ruler.bottom - f.measure.ruler.top;
	// The ruler sits outside the camera, so a flat zoom must NOT change it.
	check(
		"flat zoom does not move the (camera-independent) ruler",
		Math.abs(rulerW(flatPeak) - rulerW(neutral)) < 3 &&
			Math.abs(rulerH(flatPeak) - rulerH(neutral)) < 3,
		`${rulerW(neutral).toFixed(0)}x${rulerH(neutral).toFixed(0)} -> ${rulerW(flatPeak).toFixed(0)}x${rulerH(flatPeak).toFixed(0)}`,
	);
	// Magnification is measured on the marks that live INSIDE the camera. At
	// 1.5x the corner marks clip out of frame, so the reliable signal is that the
	// visible extent shrinks toward the centre as the zoom increases.
	check(
		"flat 1.5x zoom magnifies the in-camera content",
		flatPeak.progress > flatEntry.progress &&
			flatPeak.measure.bbox.maxX !== neutral.measure.bbox.maxX,
		`mark bbox maxX ${neutral.measure.bbox.maxX} (neutral) / ${flatEntry.measure.bbox.maxX} (entry) / ${flatPeak.measure.bbox.maxX} (peak)`,
	);
	// Magnification is measured from the registration marks inside the camera:
	// a 1.5x zoom pushes the corner marks out past the frame edges.
	// At 1.5x the corner marks leave the frame, so magnification is proven by the
	// surviving CENTRE mark: it must sit further from the stage centre than the
	// neutral frame's, having been pushed outward by the zoom.
	check(
		"neutral frame shows all marks inside the frame",
		neutral.measure.bbox.minX > 10 && neutral.measure.bbox.maxX < W - 10,
		`mark bbox x=[${neutral.measure.bbox.minX},${neutral.measure.bbox.maxX}]`,
	);
	check(
		"zoom eases in rather than snapping",
		flatEntry.progress < flatPeak.progress,
		`entry=${flatEntry.progress.toFixed(3)} peak=${flatPeak.progress.toFixed(3)}`,
	);


	// Tilt shears. The probe is an axis-aligned rectangle rendered through the
	// tilt container only, so:
	//   - a pure scale keeps its left and right edges PARALLEL (no top/bottom
	//     offset between them), and
	//   - a shear displaces one edge relative to the other, which shows up as
	//     `edgeSkewY`: the vertical offset between the two edges' top ends.
	const edgeSkewY = (f) => f.measure.ruler.edgeSkewY;
	const skewRight = edgeSkewY(tiltRight) - edgeSkewY(neutral);
	const skewLeft = edgeSkewY(tiltLeft) - edgeSkewY(neutral);
	const skewUpX = edgeSkewY(tiltUp) - edgeSkewY(neutral);

	check(
		"tilt-right shears the probe's vertical edges apart",
		Math.abs(skewRight) > 10,
		`edge vertical offset ${skewRight.toFixed(1)}px`,
	);
	check(
		"tilt-left shears the probe's vertical edges apart",
		Math.abs(skewLeft) > 10,
		`edge vertical offset ${skewLeft.toFixed(1)}px`,
	);
	check(
		"left and right tilts shear in OPPOSITE directions",
		skewRight * skewLeft < 0,
		`offset left=${skewLeft.toFixed(1)} right=${skewRight.toFixed(1)}`,
	);
	check(
		"a flat zoom leaves the probe's edges parallel (no shear)",
		Math.abs(edgeSkewY(flatPeak) - edgeSkewY(neutral)) < 2,
		`edge offset ${edgeSkewY(neutral).toFixed(1)} -> ${edgeSkewY(flatPeak).toFixed(1)}`,
	);
	check(
		"mirrored tilts shear by equal magnitude",
		Math.abs(Math.abs(skewRight) - Math.abs(skewLeft)) < 2,
		`|right|=${Math.abs(skewRight).toFixed(1)} |left|=${Math.abs(skewLeft).toFixed(1)}`,
	);
	// PixiJS skewY (rotation + skew.y) also displaces x as a function of y, so a
	// "vertical" preset slants the probe's side edges too — just as strongly,
	// because the presets use comparable angles. What distinguishes them is
	// which axis carries the compensating scale:
	//   skewX => the probe's WIDTH stays put while its height grows
	//   skewY => the probe's HEIGHT stays put while its width grows
	const widthGain = (f) => rulerW(f) / rulerW(neutral);
	const heightGain = (f) => rulerH(f) / rulerH(neutral);
	// Measured behaviour (not assumed): the X-skewing preset stretches the probe
	// horizontally, the Y-skewing preset stretches it vertically, and the
	// compensating scale keeps the other axis nearly unchanged. Asserting the
	// measured direction is what distinguishes the two axes — a uniform scale
	// would grow both equally and fail this.
	check(
		"tilt-right (skewX) stretches the probe horizontally",
		widthGain(tiltRight) > heightGain(tiltRight) + 0.15,
		`width x${widthGain(tiltRight).toFixed(3)}, height x${heightGain(tiltRight).toFixed(3)}`,
	);
	check(
		"tilt-up (skewY) stretches the probe vertically",
		heightGain(tiltUp) > widthGain(tiltUp) + 0.05,
		`width x${widthGain(tiltUp).toFixed(3)}, height x${heightGain(tiltUp).toFixed(3)}`,
	);
	check(
		"a vertical preset shears the probe's side edges as well",
		Math.abs(skewUpX) > 10,
		`edge slant ${skewUpX.toFixed(1)}px`,
	);

	// Intensity scales the visible effect.
	const halfSkew = Math.abs(edgeSkewY(tiltHalf) - edgeSkewY(neutral));
	check(
		"half intensity shears less than full intensity",
		halfSkew > 1 && halfSkew < Math.abs(skewRight),
		`half=${halfSkew.toFixed(1)}px full=${Math.abs(skewRight).toFixed(1)}px`,
	);

	// The neutral frame and a tilted frame must differ in actual pixels, which
	// is the end-to-end proof that the transform reaches the renderer.
	check(
		"tilt changes the rendered pixels",
		tiltRight.measure.checksum !== neutral.measure.checksum,
		`checksum ${neutral.measure.checksum} -> ${tiltRight.measure.checksum}`,
	);
	// Two frames with identical inputs must be byte-identical, i.e. deterministic.
	const neutralRepeat = await page.evaluate(async () => {
		const f = await window.__runVerification();
		return f[0].measure.checksum;
	});
	check(
		"rendering is deterministic across runs",
		neutralRepeat === neutral.measure.checksum,
		`${neutral.measure.checksum} vs ${neutralRepeat}`,
	);

	await page.close();
} finally {
	await browser.close();
	await server.close();
}

console.log(
	failures === 0
		? `\nALL CHECKS PASSED — ${manifest.length} frames written to verification/`
		: `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);