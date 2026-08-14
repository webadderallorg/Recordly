import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	readTiledOverlayManifest,
	resolveTiledOverlayLayerMetrics,
	resolveTiledOverlayRawFallbackReason,
	TILED_OVERLAY_STORAGE_VERSION,
	TILED_OVERLAY_TILE_BYTE_SIZE,
	TILED_OVERLAY_TILE_SIZE,
	tileCountForSize,
} from "./tiledOverlayManifest.mjs";

// Contract for the versioned tiled/delta overlay descriptor:
// - version 1, fixed 128x128 lossless raw RGBA tiles.
// - staticTiles define the full initial layer state emitted once; frameDeltas
//   carry per-frame changed tile payloads (ascending, unique frame indices).
// - Every payload region is written exactly once; the payload stream is bounded
//   by payloadPath/payloadByteLength and validated against the actual file.
// - Mirrors the TS validator so the CUDA module never trusts an opaque blob.

const OUTPUT_SIZE = { outputWidth: 1920, outputHeight: 1080, frameRate: 30, durationSec: 2 };
const LAYER_WIDTH = 384;
const LAYER_HEIGHT = 256;
const TILE_COUNT = 6; // 3 columns * 2 rows

function makeTempDir(prefix = "recordly-tiled-overlay-") {
	return mkdtempSync(join(tmpdir(), prefix));
}

function tileRecord(tileIndex, byteOffset) {
	return { tileIndex, byteOffset, byteLength: TILED_OVERLAY_TILE_BYTE_SIZE };
}

function staticTiles() {
	return Array.from({ length: TILE_COUNT }, (_, tileIndex) =>
		tileRecord(tileIndex, tileIndex * TILED_OVERLAY_TILE_BYTE_SIZE),
	);
}

function writePayload(dir, byteLength, name = "overlay-tiles.bin") {
	const payloadPath = join(dir, name);
	writeFileSync(payloadPath, Buffer.alloc(byteLength, 0x7f));
	return payloadPath;
}

function writeManifest(dir, manifest, name = "tiled-overlay-manifest.json") {
	const manifestPath = join(dir, name);
	writeFileSync(manifestPath, JSON.stringify(manifest));
	return manifestPath;
}

function tiledLayer(overrides = {}) {
	return {
		id: "tiled-effects",
		order: 0,
		x: 0,
		y: 0,
		width: LAYER_WIDTH,
		height: LAYER_HEIGHT,
		frameRate: 30,
		durationSec: 2,
		frameCount: 60,
		tileSize: TILED_OVERLAY_TILE_SIZE,
		pixelFormat: "rgba",
		payloadPath: "",
		payloadByteLength: TILE_COUNT * TILED_OVERLAY_TILE_BYTE_SIZE,
		staticTiles: staticTiles(),
		frameDeltas: [],
		...overrides,
	};
}

function tiledManifest(overrides = {}) {
	return {
		version: TILED_OVERLAY_STORAGE_VERSION,
		outputWidth: 1920,
		outputHeight: 1080,
		frameRate: 30,
		durationSec: 2,
		layers: [tiledLayer()],
		...overrides,
	};
}

describe("readTiledOverlayManifest", () => {
	it("returns an empty array when no manifest path is provided", () => {
		expect(readTiledOverlayManifest("", OUTPUT_SIZE)).toEqual([]);
		expect(readTiledOverlayManifest(null, OUTPUT_SIZE)).toEqual([]);
	});

	it("rejects a missing manifest file and invalid JSON", () => {
		expect(() => readTiledOverlayManifest("/missing/tiled.json", OUTPUT_SIZE)).toThrow(
			"Tiled overlay manifest does not exist:",
		);
		const dir = makeTempDir();
		try {
			const badJson = join(dir, "bad.json");
			writeFileSync(badJson, "{not json");
			expect(() => readTiledOverlayManifest(badJson, OUTPUT_SIZE)).toThrow(
				/Invalid tiled overlay manifest/,
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects unsupported versions and storage/output mismatches", () => {
		const dir = makeTempDir();
		try {
			const payload = writePayload(dir, TILE_COUNT * TILED_OVERLAY_TILE_BYTE_SIZE);
			const withPath = (manifest) =>
				writeManifest(dir, {
					...manifest,
					layers: Array.isArray(manifest.layers)
						? manifest.layers.map((layer) => ({ ...layer, payloadPath: payload }))
						: manifest.layers,
				});
			expect(() =>
				readTiledOverlayManifest(withPath(tiledManifest({ version: 2 })), OUTPUT_SIZE),
			).toThrow("Unsupported tiled overlay storage version 2:");
			expect(() =>
				readTiledOverlayManifest(
					withPath(tiledManifest({ outputWidth: 1280 })),
					OUTPUT_SIZE,
				),
			).toThrow("Tiled overlay storage dimensions do not match the output:");
			expect(() =>
				readTiledOverlayManifest(withPath(tiledManifest({ frameRate: 24 })), OUTPUT_SIZE),
			).toThrow("Tiled overlay storage frame rate does not match the output:");
			expect(() =>
				readTiledOverlayManifest(withPath(tiledManifest({ durationSec: 4 })), OUTPUT_SIZE),
			).toThrow("Tiled overlay storage duration does not match the output:");
			expect(() =>
				readTiledOverlayManifest(withPath(tiledManifest({ layers: null })), OUTPUT_SIZE),
			).toThrow("Tiled overlay manifest requires a layers array:");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("accepts an identical-frames layer with a static base only", () => {
		const dir = makeTempDir();
		try {
			const payload = writePayload(dir, TILE_COUNT * TILED_OVERLAY_TILE_BYTE_SIZE);
			const manifestPath = writeManifest(dir, tiledManifest());
			const manifest = JSON.parse(require("node:fs").readFileSync(manifestPath, "utf8"));
			manifest.layers[0].payloadPath = payload;
			writeFileSync(manifestPath, JSON.stringify(manifest));
			const layers = readTiledOverlayManifest(manifestPath, OUTPUT_SIZE);
			expect(layers).toHaveLength(1);
			expect(layers[0]).toMatchObject({
				id: "tiled-effects",
				width: LAYER_WIDTH,
				height: LAYER_HEIGHT,
				frameCount: 60,
				tileSize: TILED_OVERLAY_TILE_SIZE,
				pixelFormat: "rgba",
				payloadPath: payload,
				payloadByteLength: TILE_COUNT * TILED_OVERLAY_TILE_BYTE_SIZE,
			});
			expect(layers[0].staticTiles).toHaveLength(TILE_COUNT);
			expect(layers[0].frameDeltas).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("accepts moving/dynamic content described by ascending changed tile deltas", () => {
		const dir = makeTempDir();
		try {
			const payload = writePayload(dir, (TILE_COUNT + 4) * TILED_OVERLAY_TILE_BYTE_SIZE);
			const layer = tiledLayer({
				payloadPath: payload,
				payloadByteLength: (TILE_COUNT + 4) * TILED_OVERLAY_TILE_BYTE_SIZE,
				frameDeltas: [
					{
						frameIndex: 10,
						changedTiles: [tileRecord(1, TILE_COUNT * TILED_OVERLAY_TILE_BYTE_SIZE)],
					},
					{
						frameIndex: 20,
						changedTiles: [
							tileRecord(4, (TILE_COUNT + 1) * TILED_OVERLAY_TILE_BYTE_SIZE),
							tileRecord(5, (TILE_COUNT + 2) * TILED_OVERLAY_TILE_BYTE_SIZE),
						],
					},
					{
						frameIndex: 30,
						changedTiles: [
							tileRecord(2, (TILE_COUNT + 3) * TILED_OVERLAY_TILE_BYTE_SIZE),
						],
					},
				],
			});
			const manifestPath = writeManifest(dir, tiledManifest({ layers: [layer] }));
			const layers = readTiledOverlayManifest(manifestPath, OUTPUT_SIZE);
			expect(layers[0].frameDeltas).toHaveLength(3);
			expect(resolveTiledOverlayLayerMetrics(layers[0])).toEqual({
				effectiveFrameCount: 4,
				changedTileCount: 4,
				uploadedTileCount: 10,
				uploadedTileBytes: 10 * TILED_OVERLAY_TILE_BYTE_SIZE,
				cachedTileCount: TILE_COUNT * 60 - 10,
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects malformed layers, tile ranges, deltas, and unsorted ordering", () => {
		const dir = makeTempDir();
		try {
			const payload = writePayload(dir, (TILE_COUNT + 4) * TILED_OVERLAY_TILE_BYTE_SIZE);
			const payloadLarge = writePayload(
				dir,
				(TILE_COUNT + 60) * TILED_OVERLAY_TILE_BYTE_SIZE,
				"large.bin",
			);
			const run = (layer, name) => {
				const manifestPath = writeManifest(dir, tiledManifest({ layers: [layer] }), name);
				return readTiledOverlayManifest(manifestPath, OUTPUT_SIZE);
			};
			const base = (overrides = {}) => tiledLayer({ payloadPath: payload, ...overrides });

			expect(() => run(base({ pixelFormat: "yuv420p" }), "a.json")).toThrow(
				"must use RGBA tiles",
			);
			expect(() => run(base({ tileSize: 64 }), "b.json")).toThrow("must use 128px tiles");
			expect(() => run(base({ width: 0 }), "c.json")).toThrow(
				"Invalid tiled overlay layer tiled-effects:",
			);
			expect(() => run(base({ width: 1921 }), "d.json")).toThrow("exceeds the output canvas");
			expect(() => run(base({ frameCount: 59 }), "e.json")).toThrow(
				"does not contain enough frames",
			);
			expect(() => run(base({ staticTiles: null }), "f.json")).toThrow(
				"requires a static tile base",
			);
			expect(() => run(base({ frameDeltas: null }), "g.json")).toThrow(
				"requires frame delta records",
			);
			expect(() =>
				run(
					base({
						staticTiles: [
							tileRecord(0, 0),
							...staticTiles().slice(1, -1),
							tileRecord(0, TILED_OVERLAY_TILE_BYTE_SIZE),
						],
					}),
					"h.json",
				),
			).toThrow("emits duplicate static tile 0:");
			expect(() =>
				run(
					base({
						staticTiles: staticTiles().slice(0, 5),
					}),
					"i.json",
				),
			).toThrow("does not fully define the static tile base:");
			expect(() =>
				run(
					base({
						payloadByteLength: TILE_COUNT * TILED_OVERLAY_TILE_BYTE_SIZE,
						frameDeltas: [
							{
								frameIndex: 0,
								changedTiles: [
									tileRecord(0, TILE_COUNT * TILED_OVERLAY_TILE_BYTE_SIZE),
								],
							},
						],
					}),
					"j.json",
				),
			).toThrow("has an invalid tile payload range:");
			expect(() =>
				run(
					base({
						payloadByteLength: (TILE_COUNT + 2) * TILED_OVERLAY_TILE_BYTE_SIZE,
						frameDeltas: [
							{
								frameIndex: 0,
								changedTiles: [
									tileRecord(6, TILE_COUNT * TILED_OVERLAY_TILE_BYTE_SIZE),
								],
							},
						],
					}),
					"k.json",
				),
			).toThrow("references an out-of-bounds tile:");
			expect(() =>
				run(
					base({
						payloadByteLength: (TILE_COUNT + 1) * TILED_OVERLAY_TILE_BYTE_SIZE,
						frameDeltas: [
							{
								frameIndex: 20,
								changedTiles: [
									tileRecord(0, TILE_COUNT * TILED_OVERLAY_TILE_BYTE_SIZE),
								],
							},
							{
								frameIndex: 10,
								changedTiles: [
									tileRecord(1, TILE_COUNT * TILED_OVERLAY_TILE_BYTE_SIZE),
								],
							},
						],
					}),
					"l.json",
				),
			).toThrow("unsorted or duplicate delta frame indices:");
			expect(() =>
				run(
					base({
						payloadByteLength: (TILE_COUNT + 1) * TILED_OVERLAY_TILE_BYTE_SIZE,
						frameDeltas: [
							{
								frameIndex: 0,
								changedTiles: [
									tileRecord(0, TILE_COUNT * TILED_OVERLAY_TILE_BYTE_SIZE),
								],
							},
							{
								frameIndex: 1,
								changedTiles: [
									tileRecord(0, TILE_COUNT * TILED_OVERLAY_TILE_BYTE_SIZE),
								],
							},
						],
					}),
					"m.json",
				),
			).toThrow("duplicates tile payload bytes:");
			expect(() =>
				run(
					base({
						payloadPath: payloadLarge,
						payloadByteLength: (TILE_COUNT + 60) * TILED_OVERLAY_TILE_BYTE_SIZE,
						frameDeltas: Array.from({ length: 60 }, (_, frameIndex) => ({
							frameIndex,
							changedTiles: [
								tileRecord(
									0,
									(TILE_COUNT + frameIndex) * TILED_OVERLAY_TILE_BYTE_SIZE,
								),
							],
						})),
					}),
					"n.json",
				),
			).toThrow("more state versions than frames:");

			const unsorted = writeManifest(
				dir,
				tiledManifest({
					layers: [
						tiledLayer({ id: "b", order: 1, payloadPath: payload }),
						tiledLayer({ id: "a", order: 0, payloadPath: payload }),
					],
				}),
				"o.json",
			);
			expect(() => readTiledOverlayManifest(unsorted, OUTPUT_SIZE)).toThrow(
				"Tiled overlay layers must be sorted by order then id:",
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("fails a payload truncated below the declared byte length", () => {
		const dir = makeTempDir();
		try {
			const payload = writePayload(dir, TILE_COUNT * TILED_OVERLAY_TILE_BYTE_SIZE - 1);
			const manifestPath = writeManifest(
				dir,
				tiledManifest({ layers: [tiledLayer({ payloadPath: payload })] }),
			);
			expect(() => readTiledOverlayManifest(manifestPath, OUTPUT_SIZE)).toThrow(
				`Tiled overlay layer tiled-effects payload is truncated: expected at least ${
					TILE_COUNT * TILED_OVERLAY_TILE_BYTE_SIZE
				} bytes, received ${TILE_COUNT * TILED_OVERLAY_TILE_BYTE_SIZE - 1}`,
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects a missing payload file", () => {
		const dir = makeTempDir();
		try {
			const manifestPath = writeManifest(
				dir,
				tiledManifest({ layers: [tiledLayer({ payloadPath: join(dir, "nope.bin") })] }),
			);
			expect(() => readTiledOverlayManifest(manifestPath, OUTPUT_SIZE)).toThrow(
				"Tiled overlay layer tiled-effects does not exist:",
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("tiled overlay wrapper metrics and raw fallback", () => {
	it("computes tile geometry and additive metrics", () => {
		expect(tileCountForSize(384, 256)).toBe(6);
		expect(tileCountForSize(1920, 1080)).toBe(15 * 9);
		expect(TILED_OVERLAY_TILE_BYTE_SIZE).toBe(128 * 128 * 4);
	});

	it("keeps sparse layers eligible and surfaces dense/small fallback reasons", () => {
		const sparse = {
			width: LAYER_WIDTH,
			height: LAYER_HEIGHT,
			frameCount: 60,
			staticTiles: staticTiles(),
			frameDeltas: [
				{
					frameIndex: 10,
					changedTiles: [tileRecord(1, TILE_COUNT * TILED_OVERLAY_TILE_BYTE_SIZE)],
				},
			],
		};
		expect(resolveTiledOverlayRawFallbackReason(sparse)).toBeNull();

		const small = {
			width: 256,
			height: 128,
			frameCount: 60,
			staticTiles: [tileRecord(0, 0), tileRecord(1, TILED_OVERLAY_TILE_BYTE_SIZE)],
			frameDeltas: [],
		};
		expect(resolveTiledOverlayRawFallbackReason(small)).toBe("small-layer");

		const dense = {
			width: LAYER_WIDTH,
			height: LAYER_HEIGHT,
			frameCount: 60,
			staticTiles: staticTiles(),
			frameDeltas: [
				{
					frameIndex: 0,
					changedTiles: [0, 1, 2, 3].map((tileIndex, index) =>
						tileRecord(tileIndex, (TILE_COUNT + index) * TILED_OVERLAY_TILE_BYTE_SIZE),
					),
				},
			],
		};
		expect(resolveTiledOverlayRawFallbackReason(dense)).toBe("dense-frame-delta");
	});
});
