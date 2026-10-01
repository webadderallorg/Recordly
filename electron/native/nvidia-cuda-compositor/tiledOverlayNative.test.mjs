// Opt-in GPU regression test: compares actual decoded NVENC output against the
// full RGBA path, rather than duplicating the CUDA blend math in JavaScript.
// RECORDLY_CUDA_NATIVE_TESTS=1 npx vitest run <this file>
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ffmpeg from "ffmpeg-static";
import { describe, expect, it } from "vitest";

const helper = resolve(
	"electron/native/nvidia-cuda-compositor/build/Release/recordly-nvidia-cuda-compositor.exe",
);
const frames = 12;
const fps = 30;
const tileSize = 128;
const tileBytes = tileSize * tileSize * 4;

function run(command, args) {
	return execFileSync(
		command,
		args.map((arg) => arg.replaceAll("\\", "/")),
		{
			windowsHide: true,
			stdio: "pipe",
			maxBuffer: 64 * 1024 * 1024,
			timeout: 60_000,
		},
	);
}

function fixture(dir, width, height, origin) {
	const columns = Math.ceil(width / tileSize);
	const rows = Math.ceil(height / tileSize);
	const payloads = [];
	const staticTiles = [];
	const frameDeltas = [];
	const rawFrames = [];
	let previousTiles;
	for (let frame = 0; frame < frames; ++frame) {
		const rgba = Buffer.alloc(width * height * 4);
		// Transparent -> boundary-crossing alpha -> stationary reuse -> clear ->
		// partial edge tile. RGB under zero alpha must not count as visibility.
		for (let pixel = 0; pixel < width * height; ++pixel) rgba[pixel * 4] = 91;
		const phase = Math.floor(frame / 3);
		if (phase === 1 || phase === 3) {
			const left = phase === 1 ? 127 : width - 3;
			const top = phase === 1 ? 127 : height - 3;
			for (let y = top; y < Math.min(height, top + 4); ++y) {
				for (let x = left; x < Math.min(width, left + 4); ++x) {
					rgba.set([230, 45, 110, (x + y) % 2 ? 63 : 255], (y * width + x) * 4);
				}
			}
		}
		rawFrames.push(rgba);
		const tiles = [];
		const changedTiles = [];
		for (let tile = 0; tile < columns * rows; ++tile) {
			const bytes = Buffer.alloc(tileBytes, 255); // Deliberately opaque padding.
			const left = (tile % columns) * tileSize;
			const top = Math.floor(tile / columns) * tileSize;
			for (let y = 0; y < Math.min(tileSize, height - top); ++y) {
				rgba.copy(
					bytes,
					y * tileSize * 4,
					((top + y) * width + left) * 4,
					((top + y) * width + Math.min(width, left + tileSize)) * 4,
				);
			}
			tiles.push(bytes);
			if (!previousTiles || !bytes.equals(previousTiles[tile])) {
				const record = {
					tileIndex: tile,
					byteOffset: payloads.length * tileBytes,
					byteLength: tileBytes,
				};
				payloads.push(bytes);
				(frame === 0 ? staticTiles : changedTiles).push(record);
			}
		}
		if (changedTiles.length) frameDeltas.push({ frameIndex: frame, changedTiles });
		previousTiles = tiles;
	}
	const payloadPath = join(dir, "tiles.rgba");
	const rawPath = join(dir, "raw.rgba");
	writeFileSync(payloadPath, Buffer.concat(payloads));
	writeFileSync(rawPath, Buffer.concat(rawFrames));
	const layer = {
		id: "tiled",
		order: 1,
		x: origin,
		y: origin,
		width,
		height,
		frameCount: frames,
		frameRate: fps,
		durationSec: frames / fps,
		tileSize,
		pixelFormat: "rgba",
		payloadPath,
		payloadByteLength: payloads.length * tileBytes,
		// Reverse the static records to exercise assembly by tile index.
		staticTiles: staticTiles.reverse(),
		frameDeltas,
	};
	const manifest = join(dir, "manifest.json");
	writeFileSync(
		manifest,
		JSON.stringify({
			version: 1,
			outputWidth: 640,
			outputHeight: 384,
			frameRate: fps,
			durationSec: frames / fps,
			layers: [layer],
		}),
	);
	return { manifest, rawPath };
}

describe.skipIf(process.env.RECORDLY_CUDA_NATIVE_TESTS !== "1")(
	"native tiled overlay pixel parity",
	() => {
		it.each([
			0, 1,
		])("preserves alpha, clears, padding and mixed z-order at origin %i", (origin) => {
			const dir = mkdtempSync(join(tmpdir(), "recordly-tiled-native-"));
			try {
				const source = join(dir, "source.h264");
				run(ffmpeg, [
					"-v",
					"error",
					"-f",
					"lavfi",
					"-i",
					"color=c=0x305060:size=640x384:rate=30",
					"-frames:v",
					String(frames),
					"-c:v",
					"libx264",
					"-preset",
					"ultrafast",
					"-pix_fmt",
					"yuv420p",
					source,
				]);
				const width = 515;
				const height = 259;
				const { manifest, rawPath } = fixture(dir, width, height, origin);
				const lower = join(dir, "lower.rgba");
				const upper = join(dir, "upper.rgba");
				writeFileSync(
					lower,
					Buffer.from(
						Array(16 * 16)
							.fill([30, 170, 240, 130])
							.flat(),
					),
				);
				writeFileSync(
					upper,
					Buffer.from(
						Array(16 * 16)
							.fill([40, 220, 70, 90])
							.flat(),
					),
				);
				const common = [
					"--input",
					source,
					"--width",
					"640",
					"--height",
					"384",
					"--fps",
					String(fps),
					"--input-frames",
					String(frames),
					"--target-frames",
					String(frames),
					"--max-frames",
					String(frames),
					"--output-codec",
					"hevc",
					"--bitrate-mbps",
					"18",
					"--stream-sync",
					"--callback-encode",
					"--content-width",
					"640",
					"--content-height",
					"384",
					"--overlay",
					lower,
					"120",
					"120",
					"16",
					"16",
					"1",
					"0",
					"--overlay",
					upper,
					"120",
					"120",
					"16",
					"16",
					"1",
					"2",
				];
				const reference = join(dir, "reference.hevc");
				const actual = join(dir, "actual.hevc");
				run(helper, [
					...common,
					"--output",
					reference,
					"--overlay",
					rawPath,
					String(origin),
					String(origin),
					String(width),
					String(height),
					String(frames),
					"1",
				]);
				const stdout = run(helper, [
					...common,
					"--output",
					actual,
					"--tiled-overlay-manifest",
					manifest,
				]).toString();
				const summary = JSON.parse(
					stdout.split(/\r?\n/).find((line) => line.startsWith('{"success":')),
				);
				expect(summary.success).toBe(true);
				expect(summary.frames).toBe(frames);
				expect(summary.tiledOverlaySkippedPixels).toBeGreaterThan(
					(width * height * frames) / 2,
				);
				const decode = (path) =>
					run(ffmpeg, [
						"-v",
						"error",
						"-i",
						path,
						"-f",
						"rawvideo",
						"-pix_fmt",
						"yuv420p",
						"pipe:1",
					]);
				const decoded = decode(actual);
				expect(decoded.length).toBe(((640 * 384 * 3) / 2) * frames);
				if (process.env.RECORDLY_CUDA_BASELINE_HELPER) {
					const baseline = join(dir, "baseline.hevc");
					run(process.env.RECORDLY_CUDA_BASELINE_HELPER, [
						...common,
						"--output",
						baseline,
						"--tiled-overlay-manifest",
						manifest,
					]);
					expect(decoded.equals(decode(baseline)), "baseline tiled parity").toBe(true);
				}
				const expected = decode(reference);
				if (!decoded.equals(expected)) {
					const frameBytes = (640 * 384 * 3) / 2;
					console.log(
						"frame differences",
						Array.from({ length: frames }, (_, frame) => {
							let count = 0;
							let first = -1;
							for (let i = frame * frameBytes; i < (frame + 1) * frameBytes; ++i) {
								if (decoded[i] !== expected[i]) {
									count++;
									if (first < 0) first = i % frameBytes;
								}
							}
							return { frame, count, first };
						}),
					);
				}
				expect(decoded.equals(expected)).toBe(true);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		}, 60_000);

		it("keeps a native cursor atlas visible above a renderer overlay sidecar", () => {
			const dir = mkdtempSync(join(tmpdir(), "recordly-cursor-atlas-overlay-native-"));
			try {
				const source = join(dir, "source.h264");
				run(ffmpeg, [
					"-v",
					"error",
					"-f",
					"lavfi",
					"-i",
					"color=c=0x305060:size=640x384:rate=30",
					"-frames:v",
					String(frames),
					"-c:v",
					"libx264",
					"-preset",
					"ultrafast",
					"-pix_fmt",
					"yuv420p",
					source,
				]);
				const transparentSidecar = join(dir, "caption-sidecar.rgba");
				writeFileSync(transparentSidecar, Buffer.alloc(640 * 384 * 4 * frames));
				const cursorSamples = join(dir, "cursor-samples.txt");
				writeFileSync(cursorSamples, "0 0.5 0.5 0 1 1\n1000 0.5 0.5 0 1 1\n");
				const cursorAtlas = join(dir, "cursor-atlas.rgba");
				const cursorPixels = Buffer.alloc(32 * 32 * 4);
				for (let pixel = 0; pixel < 32 * 32; ++pixel) {
					cursorPixels.set([255, 255, 255, 255], pixel * 4);
				}
				writeFileSync(cursorAtlas, cursorPixels);
				const cursorMetadata = join(dir, "cursor-atlas.tsv");
				writeFileSync(cursorMetadata, "0 0 0 32 32 0 0 1\n");
				const output = join(dir, "cursor-over-sidecar.hevc");
				const stdout = run(helper, [
					"--input",
					source,
					"--output",
					output,
					"--width",
					"640",
					"--height",
					"384",
					"--fps",
					String(fps),
					"--input-frames",
					String(frames),
					"--target-frames",
					String(frames),
					"--max-frames",
					String(frames),
					"--output-codec",
					"hevc",
					"--bitrate-mbps",
					"18",
					"--stream-sync",
					"--callback-encode",
					"--content-width",
					"640",
					"--content-height",
					"384",
					"--overlay",
					transparentSidecar,
					"0",
					"0",
					"640",
					"384",
					String(frames),
					"1",
					"--cursor-samples",
					cursorSamples,
					"--cursor-height",
					"32",
					"--cursor-atlas-rgba",
					cursorAtlas,
					"--cursor-atlas-metadata",
					cursorMetadata,
					"--cursor-atlas-width",
					"32",
					"--cursor-atlas-height",
					"32",
				]).toString();
				const summary = JSON.parse(
					stdout.split(/\r?\n/).find((line) => line.startsWith('{"success":')),
				);
				expect(summary).toMatchObject({
					success: true,
					cursorAtlas: true,
					overlayLayers: 1,
				});
				const decoded = run(ffmpeg, [
					"-v",
					"error",
					"-i",
					output,
					"-f",
					"rawvideo",
					"-pix_fmt",
					"yuv420p",
					"pipe:1",
				]);
				// The white 32x32 atlas starts at the center telemetry point. If an
				// overlay sidecar suppresses native cursor ownership, this remains the
				// dark source-video luma instead of the bright cursor luma.
				for (let frame = 0; frame < frames; ++frame) {
					expect(
						decoded[frame * ((640 * 384 * 3) / 2) + 192 * 640 + 320],
					).toBeGreaterThan(200);
				}
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		}, 60_000);
	},
);
