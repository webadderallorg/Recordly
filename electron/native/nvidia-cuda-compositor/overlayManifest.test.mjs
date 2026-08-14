import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readOverlayManifest, sortOverlayLayersByOrder } from "./overlayManifest.mjs";

let tempDir;

function manifestPath() {
	return join(tempDir, "overlay-manifest.json");
}

function writeManifest(layers) {
	writeFileSync(
		manifestPath(),
		JSON.stringify({
			version: 1,
			outputWidth: 1920,
			outputHeight: 1080,
			frameRate: 30,
			durationSec: 2,
			layers,
		}),
	);
}

function rgbaLayerPath() {
	return join(tempDir, "overlay.rgba");
}

function createRgbaFile(frameCount, width = 1920, height = 1080) {
	const layerPath = rgbaLayerPath();
	const frameBytes = width * height * 4;
	const totalBytes = frameBytes * frameCount;
	writeFileSync(layerPath, Buffer.alloc(totalBytes, 0));
	return layerPath;
}

describe("readOverlayManifest non-streaming (finalized sidecar)", () => {
	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "overlay-manifest-test-"));
	});
	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("validates a complete rgba layer with matching byte size", () => {
		const layerPath = createRgbaFile(60);
		writeManifest([
			{
				id: "effects",
				path: layerPath,
				x: 0,
				y: 0,
				width: 1920,
				height: 1080,
				frameCount: 60,
				order: 0,
			},
		]);
		const layers = readOverlayManifest(manifestPath(), {
			outputWidth: 1920,
			outputHeight: 1080,
		});
		expect(layers).toHaveLength(1);
		expect(layers[0].id).toBe("effects");
		expect(layers[0].frameCount).toBe(60);
	});

	it("rejects a truncated rgba layer in non-streaming mode", () => {
		const layerPath = rgbaLayerPath();
		writeFileSync(layerPath, Buffer.alloc(1920 * 1080 * 4 * 30, 0));
		writeManifest([
			{
				id: "effects",
				path: layerPath,
				x: 0,
				y: 0,
				width: 1920,
				height: 1080,
				frameCount: 60,
				order: 0,
			},
		]);
		expect(() =>
			readOverlayManifest(manifestPath(), {
				outputWidth: 1920,
				outputHeight: 1080,
			}),
		).toThrow(/truncated/i);
	});

	it("validates effectiveFrameCount for deduped sidecars", () => {
		const layerPath = createRgbaFile(41);
		writeManifest([
			{
				id: "effects",
				path: layerPath,
				x: 0,
				y: 0,
				width: 1920,
				height: 1080,
				frameCount: 60,
				effectiveFrameCount: 41,
				order: 0,
			},
		]);
		const layers = readOverlayManifest(manifestPath(), {
			outputWidth: 1920,
			outputHeight: 1080,
		});
		expect(layers[0].effectiveFrameCount).toBe(41);
	});

	it("rejects an invalid effectiveFrameCount greater than frameCount", () => {
		const layerPath = createRgbaFile(60);
		writeManifest([
			{
				id: "effects",
				path: layerPath,
				x: 0,
				y: 0,
				width: 1920,
				height: 1080,
				frameCount: 60,
				effectiveFrameCount: 61,
				order: 0,
			},
		]);
		expect(() =>
			readOverlayManifest(manifestPath(), {
				outputWidth: 1920,
				outputHeight: 1080,
			}),
		).toThrow(/Invalid overlay manifest layer/i);
	});

	it("still validates structural fields in streaming mode", () => {
		const layerPath = createRgbaFile(60);
		writeManifest([
			{
				id: "effects",
				path: layerPath,
				x: -1,
				y: 0,
				width: 1920,
				height: 1080,
				frameCount: 60,
				order: 0,
			},
		]);
		expect(() =>
			readOverlayManifest(
				manifestPath(),
				{ outputWidth: 1920, outputHeight: 1080 },
				{ streamingRawOverlay: true },
			),
		).toThrow(/Invalid overlay manifest layer/i);
	});

	it("rejects a layer that exceeds the output canvas in streaming mode", () => {
		const layerPath = createRgbaFile(60);
		writeManifest([
			{
				id: "effects",
				path: layerPath,
				x: 100,
				y: 100,
				width: 1920,
				height: 1080,
				frameCount: 60,
				order: 0,
			},
		]);
		expect(() =>
			readOverlayManifest(
				manifestPath(),
				{ outputWidth: 1920, outputHeight: 1080 },
				{ streamingRawOverlay: true },
			),
		).toThrow(/exceeds the output canvas/i);
	});
});

describe("readOverlayManifest streaming mode", () => {
	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "overlay-manifest-test-"));
	});
	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("skips the final-size truncation check for rgba layers in streaming mode", () => {
		const layerPath = rgbaLayerPath();
		writeFileSync(layerPath, Buffer.alloc(1920 * 1080 * 4 * 10, 0));
		writeManifest([
			{
				id: "effects",
				path: layerPath,
				x: 0,
				y: 0,
				width: 1920,
				height: 1080,
				frameCount: 60,
				order: 0,
			},
		]);
		const layers = readOverlayManifest(
			manifestPath(),
			{ outputWidth: 1920, outputHeight: 1080 },
			{ streamingRawOverlay: true },
		);
		expect(layers).toHaveLength(1);
		expect(layers[0].id).toBe("effects");
		expect(layers[0].frameCount).toBe(60);
	});

	it("still requires the file to exist in streaming mode", () => {
		writeManifest([
			{
				id: "effects",
				path: join(tempDir, "nonexistent.rgba"),
				x: 0,
				y: 0,
				width: 1920,
				height: 1080,
				frameCount: 60,
				order: 0,
			},
		]);
		expect(() =>
			readOverlayManifest(
				manifestPath(),
				{ outputWidth: 1920, outputHeight: 1080 },
				{ streamingRawOverlay: true },
			),
		).toThrow(/does not exist/i);
	});

	it("still validates cursor-sprite layers with full byte check in streaming mode", () => {
		const spritePath = join(tempDir, "cursor.sprite");
		const positionsPath = join(tempDir, "cursor.positions.json");
		writeFileSync(spritePath, Buffer.alloc(32 * 32 * 4 * 10, 0));
		writeFileSync(
			positionsPath,
			JSON.stringify(Array.from({ length: 60 }, () => ({ x: 0, y: 0 }))),
		);
		writeManifest([
			{
				id: "cursor-sprite",
				kind: "cursor-sprite",
				path: spritePath,
				positionsPath,
				x: 0,
				y: 0,
				width: 32,
				height: 32,
				frameCount: 60,
				order: 1,
			},
		]);
		expect(() =>
			readOverlayManifest(
				manifestPath(),
				{ outputWidth: 1920, outputHeight: 1080 },
				{ streamingRawOverlay: true },
			),
		).toThrow(/truncated/i);
	});

	it("accepts a zero-byte rgba file in streaming mode", () => {
		const layerPath = rgbaLayerPath();
		writeFileSync(layerPath, Buffer.alloc(0));
		writeManifest([
			{
				id: "effects",
				path: layerPath,
				x: 0,
				y: 0,
				width: 1920,
				height: 1080,
				frameCount: 60,
				order: 0,
			},
		]);
		const layers = readOverlayManifest(
			manifestPath(),
			{ outputWidth: 1920, outputHeight: 1080 },
			{ streamingRawOverlay: true },
		);
		expect(layers).toHaveLength(1);
	});
});

describe("sortOverlayLayersByOrder", () => {
	it("sorts by ascending order then id", () => {
		const layers = [
			{
				id: "b",
				order: 5,
				kind: "rgba",
				path: "b.rgba",
				x: 0,
				y: 0,
				width: 10,
				height: 10,
				frameCount: 1,
			},
			{
				id: "a",
				order: 5,
				kind: "rgba",
				path: "a.rgba",
				x: 0,
				y: 0,
				width: 10,
				height: 10,
				frameCount: 1,
			},
			{
				id: "c",
				order: 1,
				kind: "rgba",
				path: "c.rgba",
				x: 0,
				y: 0,
				width: 10,
				height: 10,
				frameCount: 1,
			},
		];
		const sorted = sortOverlayLayersByOrder(layers);
		expect(sorted[0].id).toBe("c");
		expect(sorted[1].id).toBe("a");
		expect(sorted[2].id).toBe("b");
	});
});
