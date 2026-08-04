export const NATIVE_STATIC_LAYOUT_OVERLAY_PIXEL_FORMAT = "rgba" as const;

export type NativeStaticLayoutOverlayLayer = {
	id: string;
	order: number;
	path: string;
	x: number;
	y: number;
	width: number;
	height: number;
	frameRate: number;
	durationSec: number;
	frameCount: number;
	/**
	 * Physical frames present in the sidecar when renderer-side deduplication
	 * truncated an identical suffix (1 <= effectiveFrameCount <= frameCount).
	 * Native readers must clamp/repeat the last written frame for indices
	 * [effectiveFrameCount, frameCount). Absent when the layer is fully dynamic
	 * (every frame differs), so readers without dedup support behave unchanged.
	 */
	effectiveFrameCount?: number;
	pixelFormat: typeof NATIVE_STATIC_LAYOUT_OVERLAY_PIXEL_FORMAT;
};

export function getNativeStaticLayoutOverlayFrameByteSize(width: number, height: number): number {
	return Math.max(0, Math.round(width)) * Math.max(0, Math.round(height)) * 4;
}

export function areNativeStaticLayoutOverlayFramesEqual(
	left: Uint8Array,
	right: Uint8Array,
): boolean {
	if (left === right) {
		return true;
	}
	if (left.byteLength !== right.byteLength) {
		return false;
	}
	for (let index = 0; index < left.byteLength; index += 1) {
		if (left[index] !== right[index]) {
			return false;
		}
	}
	return true;
}

export function sortNativeStaticLayoutOverlayLayers(
	layers: readonly NativeStaticLayoutOverlayLayer[],
): NativeStaticLayoutOverlayLayer[] {
	return [...layers].sort(
		(left, right) => left.order - right.order || left.id.localeCompare(right.id),
	);
}

// --------------------------------------------------------------------------
// Tiled/delta overlay storage contract (sparse overlay optimization).
//
// A tiled layer stores lossless raw RGBA tiles (fixed 128x128) once and later
// references unchanged tile state instead of duplicating full 4K frames. The
// payload stream is a bounded raw RGBA byte blob referenced by the descriptor;
// every payload region is written exactly once. Sidecar/session data produced
// from this contract is never persisted. Legacy callers keep the raw full-frame
// manifest above untouched.
// --------------------------------------------------------------------------

export const NATIVE_TILED_OVERLAY_STORAGE_VERSION = 1 as const;
export const NATIVE_TILED_OVERLAY_TILE_SIZE = 128 as const;
export const NATIVE_TILED_OVERLAY_PIXEL_FORMAT = "rgba" as const;
export const NATIVE_TILED_OVERLAY_TILE_BYTE_SIZE =
	NATIVE_TILED_OVERLAY_TILE_SIZE * NATIVE_TILED_OVERLAY_TILE_SIZE * 4;

// Conservative tiled-vs-raw density/size heuristics. When any threshold is
// exceeded the renderer must keep the legacy raw full-frame sidecar instead of
// a tiled stream; the decision is observable through rawFallbackReason.
export const NATIVE_TILED_OVERLAY_MIN_TILE_COUNT = 4;
export const NATIVE_TILED_OVERLAY_MAX_CHANGED_TILE_FRACTION = 0.5;
export const NATIVE_TILED_OVERLAY_MAX_PAYLOAD_BYTES_FRACTION = 0.7;

export type NativeTiledOverlayTileRecord = {
	/** Row-major tile index within the layer (tileY * tilesPerRow + tileX). */
	tileIndex: number;
	/** Byte offset of the lossless raw RGBA tile payload in the payload stream. */
	byteOffset: number;
	/** Tile payload length; always tileSize^2 * 4 for raw RGBA tiles. */
	byteLength: number;
};

export type NativeTiledOverlayStaticTileRecord = NativeTiledOverlayTileRecord;

export type NativeTiledOverlayFrameDelta = {
	/** 0-based output frame index this delta takes effect at (ascending, unique). */
	frameIndex: number;
	/**
	 * Tiles whose state changed at this frame relative to the previous frame.
	 * Empty means an identical frame: no payload is written and all tiles keep
	 * their previously uploaded state.
	 */
	changedTiles: readonly NativeTiledOverlayTileRecord[];
};

export type NativeTiledOverlayLayerDescriptor = {
	id: string;
	order: number;
	x: number;
	y: number;
	width: number;
	height: number;
	frameRate: number;
	durationSec: number;
	/** Logical output frame count (ceil(durationSec * frameRate)). */
	frameCount: number;
	tileSize: typeof NATIVE_TILED_OVERLAY_TILE_SIZE;
	pixelFormat: typeof NATIVE_TILED_OVERLAY_PIXEL_FORMAT;
	/** Bounded reference to the lossless raw RGBA tile payload stream. */
	payloadPath: string;
	payloadByteLength: number;
	/**
	 * Initial tile state emitted once before any delta. Must contain every tile
	 * of the layer exactly once so output frame 0 is fully defined.
	 */
	staticTiles: readonly NativeTiledOverlayStaticTileRecord[];
	/**
	 * Per-frame changed tile records over the output timeline. Static tiles are
	 * emitted once and unchanged tiles are referenced (never re-uploaded), so a
	 * sparse 4K overlay does not duplicate unchanged pixels. Deltas must be
	 * sorted ascending by frameIndex with unique indices in [0, frameCount).
	 */
	frameDeltas: readonly NativeTiledOverlayFrameDelta[];
};

export type NativeTiledOverlayStorageDescriptor = {
	version: typeof NATIVE_TILED_OVERLAY_STORAGE_VERSION;
	outputWidth: number;
	outputHeight: number;
	frameRate: number;
	durationSec: number;
	layers: readonly NativeTiledOverlayLayerDescriptor[];
};

export type NativeTiledOverlayRawFallbackReason =
	| "small-layer"
	| "dense-frame-delta"
	| "payload-bytes-exceed-raw";

export function getNativeTiledOverlayTileColumns(width: number): number {
	return Math.max(1, Math.ceil(Math.max(0, width) / NATIVE_TILED_OVERLAY_TILE_SIZE));
}

export function getNativeTiledOverlayTileRows(height: number): number {
	return Math.max(1, Math.ceil(Math.max(0, height) / NATIVE_TILED_OVERLAY_TILE_SIZE));
}

export function getNativeTiledOverlayTileCount(width: number, height: number): number {
	return getNativeTiledOverlayTileColumns(width) * getNativeTiledOverlayTileRows(height);
}

export function getNativeTiledOverlayTileIndex(
	tileX: number,
	tileY: number,
	tileColumns: number,
): number {
	return tileY * tileColumns + tileX;
}

/**
 * Distinct state versions of a tiled layer: the static base emitted once plus
 * one version per frame delta. Never exceeds frameCount for a valid layer.
 */
export function getNativeTiledOverlayEffectiveFrameCount(
	layer: NativeTiledOverlayLayerDescriptor,
): number {
	return 1 + layer.frameDeltas.length;
}

export function getNativeTiledOverlayUploadedTileCount(
	layer: NativeTiledOverlayLayerDescriptor,
): number {
	let count = layer.staticTiles.length;
	for (const delta of layer.frameDeltas) {
		count += delta.changedTiles.length;
	}
	return count;
}

export type NativeTiledOverlayMetrics = {
	/** Tile payloads written across all frame deltas (excludes the static base). */
	changedTileCount: number;
	/** Tile payloads uploaded once (static base + all changed tiles). */
	uploadedTileCount: number;
	/** Bytes uploaded: uploadedTileCount * tileSize^2 * 4. */
	uploadedTileBytes: number;
	/**
	 * Tile-state lookups served from previously uploaded payloads across the
	 * full output timeline (diagnostic only; never claims zero-copy).
	 */
	cachedTileCount: number;
};

export function resolveNativeTiledOverlayMetrics(
	layer: NativeTiledOverlayLayerDescriptor,
): NativeTiledOverlayMetrics {
	const changedTileCount = layer.frameDeltas.reduce(
		(total, delta) => total + delta.changedTiles.length,
		0,
	);
	const uploadedTileCount = layer.staticTiles.length + changedTileCount;
	const tileCount = getNativeTiledOverlayTileCount(layer.width, layer.height);
	return {
		changedTileCount,
		uploadedTileCount,
		uploadedTileBytes: uploadedTileCount * NATIVE_TILED_OVERLAY_TILE_BYTE_SIZE,
		cachedTileCount: Math.max(0, tileCount * layer.frameCount - uploadedTileCount),
	};
}

/**
 * Conservative tiled-vs-raw eligibility heuristic. Returns null when the tiled
 * representation is eligible and a reason string when the layer is dense, too
 * small, or the payload no longer beats the raw full-frame sidecar. The reason
 * is observable through the rawFallbackReason metric so a silent raw fallback
 * is never indistinguishable from a tiled export.
 */
export function resolveNativeTiledOverlayRawFallbackReason(
	layer: NativeTiledOverlayLayerDescriptor,
): NativeTiledOverlayRawFallbackReason | null {
	const tileCount = getNativeTiledOverlayTileCount(layer.width, layer.height);
	if (tileCount < NATIVE_TILED_OVERLAY_MIN_TILE_COUNT) {
		return "small-layer";
	}
	for (const delta of layer.frameDeltas) {
		if (
			delta.changedTiles.length >
			tileCount * NATIVE_TILED_OVERLAY_MAX_CHANGED_TILE_FRACTION
		) {
			return "dense-frame-delta";
		}
	}
	const { uploadedTileBytes } = resolveNativeTiledOverlayMetrics(layer);
	const rawPhysicalBytes = layer.width * layer.height * 4 * layer.frameCount;
	if (uploadedTileBytes >= rawPhysicalBytes * NATIVE_TILED_OVERLAY_MAX_PAYLOAD_BYTES_FRACTION) {
		return "payload-bytes-exceed-raw";
	}
	return null;
}

/**
 * True when the referenced tile payload region is fully transparent (all zero
 * alpha/color bytes). Out-of-bounds regions are never transparent.
 */
export function isNativeTiledOverlayTilePayloadTransparent(
	payload: Uint8Array,
	tile: NativeTiledOverlayTileRecord,
): boolean {
	if (
		!Number.isSafeInteger(tile.byteOffset) ||
		!Number.isSafeInteger(tile.byteLength) ||
		tile.byteOffset < 0 ||
		tile.byteLength <= 0 ||
		tile.byteOffset + tile.byteLength > payload.byteLength
	) {
		return false;
	}
	for (let index = tile.byteOffset; index < tile.byteOffset + tile.byteLength; index += 1) {
		if (payload[index] !== 0) {
			return false;
		}
	}
	return true;
}

function validateTiledOverlayTileRecord(
	record: NativeTiledOverlayTileRecord,
	layerId: string,
	tileCount: number,
	payloadByteLength: number,
): string | null {
	if (
		!Number.isSafeInteger(record.tileIndex) ||
		record.tileIndex < 0 ||
		record.tileIndex >= tileCount
	) {
		return `tiled overlay layer ${layerId} references an out-of-bounds tile`;
	}
	if (
		!Number.isSafeInteger(record.byteOffset) ||
		record.byteOffset < 0 ||
		record.byteLength !== NATIVE_TILED_OVERLAY_TILE_BYTE_SIZE ||
		record.byteOffset + record.byteLength > payloadByteLength
	) {
		return `tiled overlay layer ${layerId} has an invalid tile payload range`;
	}
	return null;
}

export function validateNativeTiledOverlayLayerDescriptor(
	layer: NativeTiledOverlayLayerDescriptor,
	options: { outputWidth: number; outputHeight: number; durationSec: number; frameRate: number },
): string | null {
	if (
		typeof layer.id !== "string" ||
		!layer.id.trim() ||
		typeof layer.payloadPath !== "string" ||
		!layer.payloadPath.trim()
	) {
		return "tiled overlay layer requires an id and payload path";
	}
	if (layer.pixelFormat !== NATIVE_TILED_OVERLAY_PIXEL_FORMAT) {
		return `tiled overlay layer ${layer.id} must use RGBA tiles`;
	}
	if (layer.tileSize !== NATIVE_TILED_OVERLAY_TILE_SIZE) {
		return `tiled overlay layer ${layer.id} must use ${NATIVE_TILED_OVERLAY_TILE_SIZE}px tiles`;
	}
	if (!Number.isSafeInteger(layer.order) || layer.order < 0) {
		return `tiled overlay layer ${layer.id} has an invalid order`;
	}
	if (
		!Number.isSafeInteger(layer.x) ||
		!Number.isSafeInteger(layer.y) ||
		!Number.isSafeInteger(layer.width) ||
		!Number.isSafeInteger(layer.height) ||
		layer.width <= 0 ||
		layer.height <= 0 ||
		layer.x < 0 ||
		layer.y < 0 ||
		layer.x + layer.width > options.outputWidth ||
		layer.y + layer.height > options.outputHeight
	) {
		return `tiled overlay layer ${layer.id} has invalid output bounds`;
	}
	if (
		!Number.isFinite(layer.frameRate) ||
		layer.frameRate <= 0 ||
		Math.abs(layer.frameRate - options.frameRate) > 0.01
	) {
		return `tiled overlay layer ${layer.id} has an incompatible frame rate`;
	}
	if (
		!Number.isFinite(layer.durationSec) ||
		layer.durationSec <= 0 ||
		Math.abs(layer.durationSec - options.durationSec) > 1 / options.frameRate
	) {
		return `tiled overlay layer ${layer.id} has an incompatible duration`;
	}
	const expectedFrameCount = Math.ceil(layer.durationSec * layer.frameRate);
	if (!Number.isSafeInteger(layer.frameCount) || layer.frameCount < expectedFrameCount) {
		return `tiled overlay layer ${layer.id} does not contain enough frames`;
	}
	if (!Number.isSafeInteger(layer.payloadByteLength) || layer.payloadByteLength < 0) {
		return `tiled overlay layer ${layer.id} has an invalid payload byte length`;
	}
	if (!Array.isArray(layer.staticTiles)) {
		return `tiled overlay layer ${layer.id} requires a static tile base`;
	}
	if (!Array.isArray(layer.frameDeltas)) {
		return `tiled overlay layer ${layer.id} requires frame delta records`;
	}

	const tileCount = getNativeTiledOverlayTileCount(layer.width, layer.height);
	const seenStaticTiles = new Set<number>();
	const seenPayloadRanges = new Set<string>();
	const checkPayloadRange = (record: NativeTiledOverlayTileRecord): string | null => {
		const rangeKey = `${record.byteOffset}:${record.byteLength}`;
		if (seenPayloadRanges.has(rangeKey)) {
			return `tiled overlay layer ${layer.id} duplicates tile payload bytes`;
		}
		seenPayloadRanges.add(rangeKey);
		return null;
	};
	for (const record of layer.staticTiles) {
		const issue = validateTiledOverlayTileRecord(
			record,
			layer.id,
			tileCount,
			layer.payloadByteLength,
		);
		if (issue) {
			return issue;
		}
		if (seenStaticTiles.has(record.tileIndex)) {
			return `tiled overlay layer ${layer.id} emits duplicate static tile ${record.tileIndex}`;
		}
		seenStaticTiles.add(record.tileIndex);
		const rangeIssue = checkPayloadRange(record);
		if (rangeIssue) {
			return rangeIssue;
		}
	}
	if (seenStaticTiles.size !== tileCount) {
		return `tiled overlay layer ${layer.id} does not fully define the static tile base`;
	}

	let previousFrameIndex = -1;
	for (const delta of layer.frameDeltas) {
		if (
			!Number.isSafeInteger(delta.frameIndex) ||
			delta.frameIndex < 0 ||
			delta.frameIndex >= layer.frameCount
		) {
			return `tiled overlay layer ${layer.id} has an invalid delta frame index`;
		}
		if (delta.frameIndex <= previousFrameIndex) {
			return `tiled overlay layer ${layer.id} has unsorted or duplicate delta frame indices`;
		}
		previousFrameIndex = delta.frameIndex;
		const seenDeltaTiles = new Set<number>();
		for (const record of delta.changedTiles) {
			const issue = validateTiledOverlayTileRecord(
				record,
				layer.id,
				tileCount,
				layer.payloadByteLength,
			);
			if (issue) {
				return issue;
			}
			if (seenDeltaTiles.has(record.tileIndex)) {
				return `tiled overlay layer ${layer.id} repeats tile ${record.tileIndex} within a frame delta`;
			}
			seenDeltaTiles.add(record.tileIndex);
			const rangeIssue = checkPayloadRange(record);
			if (rangeIssue) {
				return rangeIssue;
			}
		}
	}
	if (getNativeTiledOverlayEffectiveFrameCount(layer) > layer.frameCount) {
		return `tiled overlay layer ${layer.id} has more state versions than frames`;
	}
	return null;
}

export function sortNativeTiledOverlayLayers(
	layers: readonly NativeTiledOverlayLayerDescriptor[],
): NativeTiledOverlayLayerDescriptor[] {
	return [...layers].sort(
		(left, right) => left.order - right.order || left.id.localeCompare(right.id),
	);
}

export function validateNativeTiledOverlayStorageDescriptor(
	descriptor: NativeTiledOverlayStorageDescriptor,
	options: { outputWidth: number; outputHeight: number; frameRate: number; durationSec: number },
): string | null {
	if (descriptor.version !== NATIVE_TILED_OVERLAY_STORAGE_VERSION) {
		return `unsupported tiled overlay storage version ${descriptor.version}`;
	}
	if (
		descriptor.outputWidth !== options.outputWidth ||
		descriptor.outputHeight !== options.outputHeight
	) {
		return "tiled overlay storage dimensions do not match the output";
	}
	if (
		!Number.isFinite(descriptor.frameRate) ||
		descriptor.frameRate <= 0 ||
		Math.abs(descriptor.frameRate - options.frameRate) > 0.01
	) {
		return "tiled overlay storage frame rate does not match the output";
	}
	if (
		!Number.isFinite(descriptor.durationSec) ||
		descriptor.durationSec <= 0 ||
		Math.abs(descriptor.durationSec - options.durationSec) > 1 / options.frameRate
	) {
		return "tiled overlay storage duration does not match the output";
	}
	if (!Array.isArray(descriptor.layers)) {
		return "tiled overlay storage requires a layers array";
	}
	let previousOrder = -1;
	let previousId = "";
	for (const layer of descriptor.layers) {
		const issue = validateNativeTiledOverlayLayerDescriptor(layer, {
			outputWidth: descriptor.outputWidth,
			outputHeight: descriptor.outputHeight,
			durationSec: descriptor.durationSec,
			frameRate: descriptor.frameRate,
		});
		if (issue) {
			return issue;
		}
		if (
			layer.order < previousOrder ||
			(layer.order === previousOrder && layer.id <= previousId)
		) {
			return "tiled overlay layers must be sorted by order then id";
		}
		previousOrder = layer.order;
		previousId = layer.id;
	}
	return null;
}

export function validateNativeStaticLayoutOverlayLayer(
	layer: NativeStaticLayoutOverlayLayer,
	options: { outputWidth: number; outputHeight: number; durationSec: number; frameRate: number },
): string | null {
	if (!layer.id.trim() || !layer.path.trim()) {
		return "overlay layer requires an id and path";
	}
	if (layer.pixelFormat !== NATIVE_STATIC_LAYOUT_OVERLAY_PIXEL_FORMAT) {
		return `overlay layer ${layer.id} must use RGBA pixels`;
	}
	if (!Number.isSafeInteger(layer.order) || layer.order < 0) {
		return `overlay layer ${layer.id} has an invalid order`;
	}
	if (
		!Number.isSafeInteger(layer.x) ||
		!Number.isSafeInteger(layer.y) ||
		!Number.isSafeInteger(layer.width) ||
		!Number.isSafeInteger(layer.height) ||
		layer.width <= 0 ||
		layer.height <= 0 ||
		layer.x < 0 ||
		layer.y < 0 ||
		layer.x + layer.width > options.outputWidth ||
		layer.y + layer.height > options.outputHeight
	) {
		return `overlay layer ${layer.id} has invalid output bounds`;
	}
	if (
		!Number.isFinite(layer.frameRate) ||
		layer.frameRate <= 0 ||
		Math.abs(layer.frameRate - options.frameRate) > 0.01
	) {
		return `overlay layer ${layer.id} has an incompatible frame rate`;
	}
	if (
		!Number.isFinite(layer.durationSec) ||
		layer.durationSec <= 0 ||
		Math.abs(layer.durationSec - options.durationSec) > 1 / options.frameRate
	) {
		return `overlay layer ${layer.id} has an incompatible duration`;
	}
	const expectedFrameCount = Math.ceil(layer.durationSec * layer.frameRate);
	if (!Number.isSafeInteger(layer.frameCount) || layer.frameCount < expectedFrameCount) {
		return `overlay layer ${layer.id} does not contain enough frames`;
	}
	if (layer.effectiveFrameCount !== undefined) {
		if (
			!Number.isSafeInteger(layer.effectiveFrameCount) ||
			layer.effectiveFrameCount < 1 ||
			layer.effectiveFrameCount > layer.frameCount
		) {
			return `overlay layer ${layer.id} has an invalid effective frame count`;
		}
	}
	return null;
}
