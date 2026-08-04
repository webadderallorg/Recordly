import { describe, expect, it } from "vitest";
import type {
	NativeStaticLayoutOverlayLayer,
	NativeTiledOverlayLayerDescriptor,
	NativeTiledOverlayStorageDescriptor,
} from "./nativeStaticLayoutOverlays";
import {
	areNativeStaticLayoutOverlayFramesEqual,
	getNativeStaticLayoutOverlayFrameByteSize,
	getNativeTiledOverlayEffectiveFrameCount,
	getNativeTiledOverlayTileColumns,
	getNativeTiledOverlayTileCount,
	getNativeTiledOverlayTileIndex,
	getNativeTiledOverlayTileRows,
	getNativeTiledOverlayUploadedTileCount,
	isNativeTiledOverlayTilePayloadTransparent,
	NATIVE_TILED_OVERLAY_MAX_CHANGED_TILE_FRACTION,
	NATIVE_TILED_OVERLAY_MIN_TILE_COUNT,
	NATIVE_TILED_OVERLAY_PIXEL_FORMAT,
	NATIVE_TILED_OVERLAY_STORAGE_VERSION,
	NATIVE_TILED_OVERLAY_TILE_BYTE_SIZE,
	NATIVE_TILED_OVERLAY_TILE_SIZE,
	resolveNativeTiledOverlayMetrics,
	resolveNativeTiledOverlayRawFallbackReason,
	sortNativeStaticLayoutOverlayLayers,
	sortNativeTiledOverlayLayers,
	validateNativeStaticLayoutOverlayLayer,
	validateNativeTiledOverlayLayerDescriptor,
	validateNativeTiledOverlayStorageDescriptor,
} from "./nativeStaticLayoutOverlays";

const layer = (
	overrides: Partial<NativeStaticLayoutOverlayLayer> = {},
): NativeStaticLayoutOverlayLayer => ({
	id: "overlay",
	order: 0,
	path: "C:/Temp/overlay.rgba",
	x: 0,
	y: 0,
	width: 1920,
	height: 1080,
	frameRate: 30,
	durationSec: 2,
	frameCount: 60,
	pixelFormat: "rgba",
	...overrides,
});

describe("native static-layout overlay layers", () => {
	it("calculates RGBA frame size", () => {
		expect(getNativeStaticLayoutOverlayFrameByteSize(1920, 1080)).toBe(1920 * 1080 * 4);
	});

	it("detects byte-identical RGBA overlay frames", () => {
		const frameA = new Uint8Array([1, 2, 3, 4, 5]);
		const frameACopy = new Uint8Array([1, 2, 3, 4, 5]);
		const frameB = new Uint8Array([1, 2, 3, 4, 6]);
		const shortFrame = new Uint8Array([1, 2, 3, 4]);

		expect(areNativeStaticLayoutOverlayFramesEqual(frameA, frameA)).toBe(true);
		expect(areNativeStaticLayoutOverlayFramesEqual(frameA, frameACopy)).toBe(true);
		expect(areNativeStaticLayoutOverlayFramesEqual(frameA, frameB)).toBe(false);
		expect(areNativeStaticLayoutOverlayFramesEqual(frameA, shortFrame)).toBe(false);
		expect(areNativeStaticLayoutOverlayFramesEqual(shortFrame, frameA)).toBe(false);
	});

	it("rejects layers with an invalid effective frame count", () => {
		const options = {
			outputWidth: 1920,
			outputHeight: 1080,
			durationSec: 2,
			frameRate: 30,
		};
		expect(
			validateNativeStaticLayoutOverlayLayer(layer({ effectiveFrameCount: 1 }), options),
		).toBeNull();
		expect(
			validateNativeStaticLayoutOverlayLayer(layer({ effectiveFrameCount: 60 }), options),
		).toBeNull();
		expect(
			validateNativeStaticLayoutOverlayLayer(layer({ effectiveFrameCount: 0 }), options),
		).toBe("overlay layer overlay has an invalid effective frame count");
		expect(
			validateNativeStaticLayoutOverlayLayer(layer({ effectiveFrameCount: 61 }), options),
		).toBe("overlay layer overlay has an invalid effective frame count");
		expect(
			validateNativeStaticLayoutOverlayLayer(layer({ effectiveFrameCount: 1.5 }), options),
		).toBe("overlay layer overlay has an invalid effective frame count");
	});

	it("sorts layers by z-order and then id", () => {
		expect(
			sortNativeStaticLayoutOverlayLayers([
				layer({ id: "b", order: 1 }),
				layer({ id: "z", order: 0 }),
				layer({ id: "a", order: 0 }),
			]).map((entry) => entry.id),
		).toEqual(["a", "z", "b"]);
	});

	it("rejects layers that do not match the output timeline", () => {
		expect(
			validateNativeStaticLayoutOverlayLayer(layer({ width: 1921 }), {
				outputWidth: 1920,
				outputHeight: 1080,
				durationSec: 2,
				frameRate: 30,
			}),
		).toBe("overlay layer overlay has invalid output bounds");
		expect(
			validateNativeStaticLayoutOverlayLayer(layer({ frameRate: 24 }), {
				outputWidth: 1920,
				outputHeight: 1080,
				durationSec: 2,
				frameRate: 30,
			}),
		).toContain("incompatible frame rate");
	});
});

// Tiled/delta overlay storage contract (sparse overlay optimization). Fixed
// 128x128 lossless raw RGBA tiles: staticTiles define the full initial layer
// state emitted once; frameDeltas carry per-frame changed tiles. Every payload
// region is written exactly once and unchanged tiles are referenced, so sparse
// 4K overlays never duplicate unchanged pixels.

const TILED_TILE_BYTE_SIZE = 128 * 128 * 4;
const TILED_LAYER_WIDTH = 384;
const TILED_LAYER_HEIGHT = 256;
const TILED_LAYER_TILE_COUNT = 3 * 2; // ceil(384/128) * ceil(256/128)

function tiledTileRecord(
	tileIndex: number,
	byteOffset: number,
	overrides: Partial<{ byteLength: number; byteOffset: number }> = {},
) {
	return { tileIndex, byteOffset, byteLength: TILED_TILE_BYTE_SIZE, ...overrides };
}

function staticTilesFor(tileCount = TILED_LAYER_TILE_COUNT) {
	return Array.from({ length: tileCount }, (_, tileIndex) =>
		tiledTileRecord(tileIndex, tileIndex * TILED_TILE_BYTE_SIZE),
	);
}

function tiledLayer(
	overrides: Partial<NativeTiledOverlayLayerDescriptor> = {},
): NativeTiledOverlayLayerDescriptor {
	return {
		id: "tiled-effects",
		order: 0,
		x: 0,
		y: 0,
		width: TILED_LAYER_WIDTH,
		height: TILED_LAYER_HEIGHT,
		frameRate: 30,
		durationSec: 2,
		frameCount: 60,
		tileSize: NATIVE_TILED_OVERLAY_TILE_SIZE,
		pixelFormat: NATIVE_TILED_OVERLAY_PIXEL_FORMAT,
		payloadPath: "C:/Temp/tiled-overlay.bin",
		payloadByteLength: TILED_LAYER_TILE_COUNT * TILED_TILE_BYTE_SIZE,
		staticTiles: staticTilesFor(),
		frameDeltas: [],
		...overrides,
	};
}

function tiledStorageDescriptor(
	overrides: Partial<NativeTiledOverlayStorageDescriptor> = {},
): NativeTiledOverlayStorageDescriptor {
	return {
		version: NATIVE_TILED_OVERLAY_STORAGE_VERSION,
		outputWidth: 1920,
		outputHeight: 1080,
		frameRate: 30,
		durationSec: 2,
		layers: [tiledLayer()],
		...overrides,
	};
}

const tiledTimelineOptions = {
	outputWidth: 1920,
	outputHeight: 1080,
	durationSec: 2,
	frameRate: 30,
};

describe("tiled overlay storage constants and geometry", () => {
	it("fixes the 128px lossless raw RGBA tile contract", () => {
		expect(NATIVE_TILED_OVERLAY_STORAGE_VERSION).toBe(1);
		expect(NATIVE_TILED_OVERLAY_TILE_SIZE).toBe(128);
		expect(NATIVE_TILED_OVERLAY_PIXEL_FORMAT).toBe("rgba");
		expect(NATIVE_TILED_OVERLAY_TILE_BYTE_SIZE).toBe(128 * 128 * 4);
		expect(NATIVE_TILED_OVERLAY_MIN_TILE_COUNT).toBeGreaterThan(1);
		expect(NATIVE_TILED_OVERLAY_MAX_CHANGED_TILE_FRACTION).toBeGreaterThan(0);
	});

	it("computes tile columns, rows, count, and row-major indices", () => {
		expect(getNativeTiledOverlayTileColumns(384)).toBe(3);
		expect(getNativeTiledOverlayTileRows(256)).toBe(2);
		expect(getNativeTiledOverlayTileCount(384, 256)).toBe(6);
		expect(getNativeTiledOverlayTileCount(1920, 1080)).toBe(15 * 9);
		expect(getNativeTiledOverlayTileIndex(2, 1, 3)).toBe(5);
		expect(getNativeTiledOverlayTileCount(0, 0)).toBe(1);
	});

	it("sorts tiled layers by z-order and then id like the raw contract", () => {
		expect(
			sortNativeTiledOverlayLayers([
				tiledLayer({ id: "b", order: 1 }),
				tiledLayer({ id: "z", order: 0 }),
				tiledLayer({ id: "a", order: 0 }),
			]).map((entry) => entry.id),
		).toEqual(["a", "z", "b"]);
	});
});

describe("tiled overlay identical frames and dynamic deltas", () => {
	it("accepts an identical-frames layer with a static base only", () => {
		expect(
			validateNativeTiledOverlayLayerDescriptor(tiledLayer(), tiledTimelineOptions),
		).toBeNull();
		expect(getNativeTiledOverlayEffectiveFrameCount(tiledLayer())).toBe(1);
		expect(getNativeTiledOverlayUploadedTileCount(tiledLayer())).toBe(TILED_LAYER_TILE_COUNT);
		expect(resolveNativeTiledOverlayMetrics(tiledLayer())).toEqual({
			changedTileCount: 0,
			uploadedTileCount: TILED_LAYER_TILE_COUNT,
			uploadedTileBytes: TILED_LAYER_TILE_COUNT * TILED_TILE_BYTE_SIZE,
			cachedTileCount: TILED_LAYER_TILE_COUNT * 60 - TILED_LAYER_TILE_COUNT,
		});
	});

	it("accepts moving/dynamic content described by ascending changed tile deltas", () => {
		const nextOffset = TILED_LAYER_TILE_COUNT * TILED_TILE_BYTE_SIZE;
		const layer = tiledLayer({
			payloadByteLength: nextOffset + 4 * TILED_TILE_BYTE_SIZE,
			frameDeltas: [
				{ frameIndex: 10, changedTiles: [tiledTileRecord(1, nextOffset)] },
				{
					frameIndex: 20,
					changedTiles: [
						tiledTileRecord(4, nextOffset + TILED_TILE_BYTE_SIZE),
						tiledTileRecord(5, nextOffset + 2 * TILED_TILE_BYTE_SIZE),
					],
				},
				{
					frameIndex: 30,
					changedTiles: [tiledTileRecord(2, nextOffset + 3 * TILED_TILE_BYTE_SIZE)],
				},
			],
		});
		expect(validateNativeTiledOverlayLayerDescriptor(layer, tiledTimelineOptions)).toBeNull();
		expect(getNativeTiledOverlayEffectiveFrameCount(layer)).toBe(4);
		expect(resolveNativeTiledOverlayMetrics(layer)).toEqual({
			changedTileCount: 4,
			uploadedTileCount: 10,
			uploadedTileBytes: 10 * TILED_TILE_BYTE_SIZE,
			cachedTileCount: TILED_LAYER_TILE_COUNT * 60 - 10,
		});
	});

	it("allows identical frames to repeat state between deltas", () => {
		const layer = tiledLayer({
			payloadByteLength: TILED_LAYER_TILE_COUNT * TILED_TILE_BYTE_SIZE + TILED_TILE_BYTE_SIZE,
			frameDeltas: [
				{
					frameIndex: 5,
					changedTiles: [
						tiledTileRecord(0, TILED_LAYER_TILE_COUNT * TILED_TILE_BYTE_SIZE),
					],
				},
			],
		});
		expect(validateNativeTiledOverlayLayerDescriptor(layer, tiledTimelineOptions)).toBeNull();
	});
});

describe("tiled overlay transparent tile payloads", () => {
	it("detects fully transparent (all-zero) tile payload regions", () => {
		const payload = new Uint8Array(2 * TILED_TILE_BYTE_SIZE);
		expect(isNativeTiledOverlayTilePayloadTransparent(payload, tiledTileRecord(0, 0))).toBe(
			true,
		);
		payload[TILED_TILE_BYTE_SIZE + 7] = 1;
		expect(
			isNativeTiledOverlayTilePayloadTransparent(
				payload,
				tiledTileRecord(1, TILED_TILE_BYTE_SIZE),
			),
		).toBe(false);
	});

	it("never treats out-of-bounds tile regions as transparent", () => {
		const payload = new Uint8Array(TILED_TILE_BYTE_SIZE);
		expect(
			isNativeTiledOverlayTilePayloadTransparent(
				payload,
				tiledTileRecord(0, TILED_TILE_BYTE_SIZE),
			),
		).toBe(false);
		expect(isNativeTiledOverlayTilePayloadTransparent(payload, tiledTileRecord(0, 1))).toBe(
			false,
		);
	});
});

describe("tiled overlay invalid metadata and bytes", () => {
	it("rejects non-RGBA pixel formats and non-128px tiles", () => {
		expect(
			validateNativeTiledOverlayLayerDescriptor(
				tiledLayer({ pixelFormat: "yuv420p" }),
				tiledTimelineOptions,
			),
		).toBe("tiled overlay layer tiled-effects must use RGBA tiles");
		expect(
			validateNativeTiledOverlayLayerDescriptor(
				tiledLayer({ tileSize: 64 }),
				tiledTimelineOptions,
			),
		).toBe("tiled overlay layer tiled-effects must use 128px tiles");
	});

	it("rejects missing id/payload path and malformed geometry/timeline", () => {
		expect(
			validateNativeTiledOverlayLayerDescriptor(
				tiledLayer({ id: " " }),
				tiledTimelineOptions,
			),
		).toBe("tiled overlay layer requires an id and payload path");
		expect(
			validateNativeTiledOverlayLayerDescriptor(
				tiledLayer({ payloadPath: "" }),
				tiledTimelineOptions,
			),
		).toBe("tiled overlay layer requires an id and payload path");
		expect(
			validateNativeTiledOverlayLayerDescriptor(
				tiledLayer({ width: 1921 }),
				tiledTimelineOptions,
			),
		).toContain("invalid output bounds");
		expect(
			validateNativeTiledOverlayLayerDescriptor(
				tiledLayer({ frameRate: 24 }),
				tiledTimelineOptions,
			),
		).toContain("incompatible frame rate");
		expect(
			validateNativeTiledOverlayLayerDescriptor(
				tiledLayer({ durationSec: 3 }),
				tiledTimelineOptions,
			),
		).toContain("incompatible duration");
		expect(
			validateNativeTiledOverlayLayerDescriptor(
				tiledLayer({ frameCount: 59 }),
				tiledTimelineOptions,
			),
		).toBe("tiled overlay layer tiled-effects does not contain enough frames");
	});

	it("rejects missing static/delta arrays and invalid payload byte length", () => {
		expect(
			validateNativeTiledOverlayLayerDescriptor(
				tiledLayer({ staticTiles: undefined as never }),
				tiledTimelineOptions,
			),
		).toBe("tiled overlay layer tiled-effects requires a static tile base");
		expect(
			validateNativeTiledOverlayLayerDescriptor(
				tiledLayer({ frameDeltas: undefined as never }),
				tiledTimelineOptions,
			),
		).toBe("tiled overlay layer tiled-effects requires frame delta records");
		expect(
			validateNativeTiledOverlayLayerDescriptor(
				tiledLayer({ payloadByteLength: -1 }),
				tiledTimelineOptions,
			),
		).toBe("tiled overlay layer tiled-effects has an invalid payload byte length");
	});

	it("rejects invalid tile payload ranges and out-of-bounds tile indices", () => {
		const invalidRange = tiledTileRecord(0, 0, {
			byteLength: TILED_TILE_BYTE_SIZE - 1,
		});
		expect(
			validateNativeTiledOverlayLayerDescriptor(
				tiledLayer({
					staticTiles: [invalidRange, ...staticTilesFor().slice(1)],
				}),
				tiledTimelineOptions,
			),
		).toBe("tiled overlay layer tiled-effects has an invalid tile payload range");
		expect(
			validateNativeTiledOverlayLayerDescriptor(
				tiledLayer({
					staticTiles: [
						tiledTileRecord(0, 0, { byteOffset: -4 }),
						...staticTilesFor().slice(1),
					],
				}),
				tiledTimelineOptions,
			),
		).toBe("tiled overlay layer tiled-effects has an invalid tile payload range");
		expect(
			validateNativeTiledOverlayLayerDescriptor(
				tiledLayer({ payloadByteLength: TILED_TILE_BYTE_SIZE }),
				tiledTimelineOptions,
			),
		).toBe("tiled overlay layer tiled-effects has an invalid tile payload range");
		expect(
			validateNativeTiledOverlayLayerDescriptor(
				tiledLayer({
					staticTiles: [tiledTileRecord(6, 0), ...staticTilesFor().slice(1)],
				}),
				tiledTimelineOptions,
			),
		).toBe("tiled overlay layer tiled-effects references an out-of-bounds tile");
	});

	it("rejects duplicate static tiles and an incomplete static tile base", () => {
		expect(
			validateNativeTiledOverlayLayerDescriptor(
				tiledLayer({
					staticTiles: [
						tiledTileRecord(0, 0),
						tiledTileRecord(0, TILED_TILE_BYTE_SIZE),
						...staticTilesFor().slice(2),
					],
				}),
				tiledTimelineOptions,
			),
		).toBe("tiled overlay layer tiled-effects emits duplicate static tile 0");
		expect(
			validateNativeTiledOverlayLayerDescriptor(
				tiledLayer({ staticTiles: staticTilesFor().slice(0, 5) }),
				tiledTimelineOptions,
			),
		).toBe("tiled overlay layer tiled-effects does not fully define the static tile base");
	});

	it("rejects duplicate tiles inside a frame delta", () => {
		const layer = tiledLayer({
			payloadByteLength: (TILED_LAYER_TILE_COUNT + 1) * TILED_TILE_BYTE_SIZE,
			frameDeltas: [
				{
					frameIndex: 0,
					changedTiles: [
						tiledTileRecord(0, TILED_LAYER_TILE_COUNT * TILED_TILE_BYTE_SIZE),
						tiledTileRecord(0, TILED_LAYER_TILE_COUNT * TILED_TILE_BYTE_SIZE),
					],
				},
			],
		});
		expect(validateNativeTiledOverlayLayerDescriptor(layer, tiledTimelineOptions)).toBe(
			"tiled overlay layer tiled-effects repeats tile 0 within a frame delta",
		);
	});

	it("rejects unsorted, duplicate, and out-of-range delta frame indices", () => {
		const base = (frameIndices: number[]) =>
			tiledLayer({
				payloadByteLength:
					(TILED_LAYER_TILE_COUNT + frameIndices.length) * TILED_TILE_BYTE_SIZE,
				frameDeltas: frameIndices.map((frameIndex, index) => ({
					frameIndex,
					changedTiles: [
						tiledTileRecord(0, (TILED_LAYER_TILE_COUNT + index) * TILED_TILE_BYTE_SIZE),
					],
				})),
			});
		expect(
			validateNativeTiledOverlayLayerDescriptor(base([20, 10]), tiledTimelineOptions),
		).toBe("tiled overlay layer tiled-effects has unsorted or duplicate delta frame indices");
		expect(
			validateNativeTiledOverlayLayerDescriptor(base([10, 10]), tiledTimelineOptions),
		).toBe("tiled overlay layer tiled-effects has unsorted or duplicate delta frame indices");
		expect(validateNativeTiledOverlayLayerDescriptor(base([60]), tiledTimelineOptions)).toBe(
			"tiled overlay layer tiled-effects has an invalid delta frame index",
		);
	});

	it("rejects more state versions than the logical frame count", () => {
		// 1 output frame (1/30s at 30fps) cannot host 3 state versions (static
		// base + deltas at frames 0 and 1) when frameCount is only 2.
		const shortTimeline = {
			outputWidth: 1920,
			outputHeight: 1080,
			durationSec: 1 / 30,
			frameRate: 30,
		};
		const layer = tiledLayer({
			frameCount: 2,
			durationSec: 1 / 30,
			payloadByteLength: (TILED_LAYER_TILE_COUNT + 2) * TILED_TILE_BYTE_SIZE,
			frameDeltas: [
				{
					frameIndex: 0,
					changedTiles: [
						tiledTileRecord(0, TILED_LAYER_TILE_COUNT * TILED_TILE_BYTE_SIZE),
					],
				},
				{
					frameIndex: 1,
					changedTiles: [
						tiledTileRecord(0, (TILED_LAYER_TILE_COUNT + 1) * TILED_TILE_BYTE_SIZE),
					],
				},
			],
		});
		expect(validateNativeTiledOverlayLayerDescriptor(layer, shortTimeline)).toBe(
			"tiled overlay layer tiled-effects has more state versions than frames",
		);
	});

	it("rejects duplicate payload byte ranges across the stream", () => {
		const layer = tiledLayer({
			payloadByteLength: TILED_LAYER_TILE_COUNT * TILED_TILE_BYTE_SIZE + TILED_TILE_BYTE_SIZE,
			frameDeltas: [
				{
					frameIndex: 0,
					changedTiles: [
						tiledTileRecord(0, TILED_LAYER_TILE_COUNT * TILED_TILE_BYTE_SIZE),
					],
				},
				{
					frameIndex: 1,
					changedTiles: [
						tiledTileRecord(1, TILED_LAYER_TILE_COUNT * TILED_TILE_BYTE_SIZE),
					],
				},
			],
		});
		expect(validateNativeTiledOverlayLayerDescriptor(layer, tiledTimelineOptions)).toBe(
			"tiled overlay layer tiled-effects duplicates tile payload bytes",
		);
	});
});

describe("tiled overlay storage descriptor", () => {
	it("validates version, output dimensions, frame rate, and duration", () => {
		expect(
			validateNativeTiledOverlayStorageDescriptor(
				tiledStorageDescriptor(),
				tiledTimelineOptions,
			),
		).toBeNull();
		expect(
			validateNativeTiledOverlayStorageDescriptor(
				tiledStorageDescriptor({ version: 2 }),
				tiledTimelineOptions,
			),
		).toBe("unsupported tiled overlay storage version 2");
		expect(
			validateNativeTiledOverlayStorageDescriptor(
				tiledStorageDescriptor({ outputWidth: 1280 }),
				tiledTimelineOptions,
			),
		).toBe("tiled overlay storage dimensions do not match the output");
		expect(
			validateNativeTiledOverlayStorageDescriptor(
				tiledStorageDescriptor({ frameRate: 24 }),
				tiledTimelineOptions,
			),
		).toBe("tiled overlay storage frame rate does not match the output");
		expect(
			validateNativeTiledOverlayStorageDescriptor(
				tiledStorageDescriptor({ durationSec: 4 }),
				tiledTimelineOptions,
			),
		).toBe("tiled overlay storage duration does not match the output");
		expect(
			validateNativeTiledOverlayStorageDescriptor(
				tiledStorageDescriptor({ layers: undefined as never }),
				tiledTimelineOptions,
			),
		).toBe("tiled overlay storage requires a layers array");
	});

	it("requires layers sorted by order then id with unique identities", () => {
		const unsorted = tiledStorageDescriptor({
			layers: [tiledLayer({ id: "b", order: 1 }), tiledLayer({ id: "a", order: 0 })],
		});
		expect(validateNativeTiledOverlayStorageDescriptor(unsorted, tiledTimelineOptions)).toBe(
			"tiled overlay layers must be sorted by order then id",
		);
		const duplicateId = tiledStorageDescriptor({
			layers: [tiledLayer({ id: "a", order: 0 }), tiledLayer({ id: "a", order: 0 })],
		});
		expect(validateNativeTiledOverlayStorageDescriptor(duplicateId, tiledTimelineOptions)).toBe(
			"tiled overlay layers must be sorted by order then id",
		);
	});
});

describe("tiled overlay raw fallback heuristic", () => {
	it("keeps sparse eligible layers on the tiled path", () => {
		const layer = tiledLayer({
			payloadByteLength: (TILED_LAYER_TILE_COUNT + 3) * TILED_TILE_BYTE_SIZE,
			frameDeltas: [
				{
					frameIndex: 10,
					changedTiles: [
						tiledTileRecord(1, TILED_LAYER_TILE_COUNT * TILED_TILE_BYTE_SIZE),
					],
				},
				{
					frameIndex: 20,
					changedTiles: [
						tiledTileRecord(4, (TILED_LAYER_TILE_COUNT + 1) * TILED_TILE_BYTE_SIZE),
					],
				},
				{
					frameIndex: 30,
					changedTiles: [
						tiledTileRecord(2, (TILED_LAYER_TILE_COUNT + 2) * TILED_TILE_BYTE_SIZE),
					],
				},
			],
		});
		expect(resolveNativeTiledOverlayRawFallbackReason(layer)).toBeNull();
	});

	it("falls back to raw for layers smaller than the minimum tile count", () => {
		const smallLayer = tiledLayer({
			width: 256,
			height: 128,
			staticTiles: staticTilesFor(2),
		});
		expect(resolveNativeTiledOverlayRawFallbackReason(smallLayer)).toBe("small-layer");
	});

	it("falls back to raw when a single frame changes a dense tile fraction", () => {
		const layer = tiledLayer({
			payloadByteLength: (TILED_LAYER_TILE_COUNT + 4) * TILED_TILE_BYTE_SIZE,
			frameDeltas: [
				{
					frameIndex: 0,
					changedTiles: [0, 1, 2, 3].map((tileIndex, index) =>
						tiledTileRecord(
							tileIndex,
							(TILED_LAYER_TILE_COUNT + index) * TILED_TILE_BYTE_SIZE,
						),
					),
				},
			],
		});
		expect(resolveNativeTiledOverlayRawFallbackReason(layer)).toBe("dense-frame-delta");
	});

	it("falls back to raw when the payload no longer beats the raw sidecar", () => {
		const layer = tiledLayer({
			frameCount: 2,
			payloadByteLength: (TILED_LAYER_TILE_COUNT + 3) * TILED_TILE_BYTE_SIZE,
			frameDeltas: [
				{
					frameIndex: 0,
					changedTiles: [0, 1, 2].map((tileIndex, index) =>
						tiledTileRecord(
							tileIndex,
							(TILED_LAYER_TILE_COUNT + index) * TILED_TILE_BYTE_SIZE,
						),
					),
				},
			],
		});
		expect(resolveNativeTiledOverlayRawFallbackReason(layer)).toBe("payload-bytes-exceed-raw");
	});
});

describe("raw + tiled overlay compatibility", () => {
	it("keeps the legacy raw RGBA contract fully untouched", () => {
		const raw = layer({ effectiveFrameCount: 1 });
		expect(
			validateNativeStaticLayoutOverlayLayer(raw, {
				outputWidth: 1920,
				outputHeight: 1080,
				durationSec: 2,
				frameRate: 30,
			}),
		).toBeNull();
		expect(getNativeStaticLayoutOverlayFrameByteSize(raw.width, raw.height)).toBe(
			raw.width * raw.height * 4,
		);
		expect(
			areNativeStaticLayoutOverlayFramesEqual(
				new Uint8Array([1, 2, 3, 4]),
				new Uint8Array([1, 2, 3, 4]),
			),
		).toBe(true);
		expect(
			sortNativeStaticLayoutOverlayLayers([
				layer({ id: "b", order: 1 }),
				layer({ id: "a", order: 0 }),
			]).map((entry) => entry.id),
		).toEqual(["a", "b"]);
	});

	it("tiled validation rejects raw-shaped manifests and vice versa", () => {
		const rawShaped = {
			id: "raw-layer",
			order: 0,
			path: "overlay.rgba",
			x: 0,
			y: 0,
			width: 384,
			height: 256,
			frameRate: 30,
			durationSec: 2,
			frameCount: 60,
			pixelFormat: "rgba",
		} as unknown as NativeTiledOverlayLayerDescriptor;
		expect(validateNativeTiledOverlayLayerDescriptor(rawShaped, tiledTimelineOptions)).toBe(
			"tiled overlay layer requires an id and payload path",
		);

		const tiledAsRaw = tiledLayer() as unknown as {
			path?: string;
			effectiveFrameCount?: number;
		};
		expect("path" in tiledAsRaw).toBe(false);
		expect(tiledAsRaw.effectiveFrameCount).toBeUndefined();
	});
});
