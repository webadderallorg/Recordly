// Renderer-prepared tiled/delta transparent RGBA overlay manifest reader for
// the NVIDIA CUDA compositor wrapper (run-mp4-pipeline.mjs).
//
// Mirrors the TS contract in src/lib/exporter/nativeStaticLayoutOverlays.ts
// (validated independently so the CUDA module never trusts an opaque blob).
// Fixed 128x128 lossless raw RGBA tiles: staticTiles define the full initial
// layer state emitted once; frameDeltas carry per-frame changed tile payloads.
// The payload stream is bounded (payloadPath/payloadByteLength); every payload
// region is written exactly once and unchanged tiles are referenced, so sparse
// 4K overlays never duplicate unchanged pixels. Sidecar/session data produced
// from this contract is never persisted.

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

export const TILED_OVERLAY_STORAGE_VERSION = 1;
export const TILED_OVERLAY_TILE_SIZE = 128;
export const TILED_OVERLAY_PIXEL_FORMAT = "rgba";
export const TILED_OVERLAY_TILE_BYTE_SIZE = TILED_OVERLAY_TILE_SIZE * TILED_OVERLAY_TILE_SIZE * 4;

// Conservative tiled-vs-raw density/size heuristics mirrored from the TS side.
const TILED_OVERLAY_MIN_TILE_COUNT = 4;
const TILED_OVERLAY_MAX_CHANGED_TILE_FRACTION = 0.5;
const TILED_OVERLAY_MAX_PAYLOAD_BYTES_FRACTION = 0.7;

function fail(message) {
	throw new Error(message);
}

function isSafeInteger(value) {
	return Number.isSafeInteger(value);
}

function isValidFrameRate(value, expected) {
	return (
		typeof value === "number" &&
		Number.isFinite(value) &&
		value > 0 &&
		Math.abs(value - expected) <= 0.01
	);
}

export function tileCountForSize(width, height) {
	const columns = Math.max(1, Math.ceil(width / TILED_OVERLAY_TILE_SIZE));
	const rows = Math.max(1, Math.ceil(height / TILED_OVERLAY_TILE_SIZE));
	return columns * rows;
}

function validateTileRecord(record, layerId, tileCount, payloadByteLength) {
	if (
		!isSafeInteger(record?.tileIndex) ||
		record.tileIndex < 0 ||
		record.tileIndex >= tileCount
	) {
		return `Tiled overlay layer ${layerId} references an out-of-bounds tile: ${JSON.stringify(record)}`;
	}
	if (
		!isSafeInteger(record?.byteOffset) ||
		record.byteOffset < 0 ||
		!isSafeInteger(record?.byteLength) ||
		record.byteLength !== TILED_OVERLAY_TILE_BYTE_SIZE ||
		record.byteOffset + record.byteLength > payloadByteLength
	) {
		return `Tiled overlay layer ${layerId} has an invalid tile payload range: ${JSON.stringify(record)}`;
	}
	return null;
}

export function readTiledOverlayManifest(manifestPath, outputSize) {
	if (!manifestPath) {
		return [];
	}
	const { outputWidth, outputHeight, frameRate, durationSec } = outputSize;
	const resolvedPath = resolve(manifestPath);
	if (!existsSync(resolvedPath)) {
		fail(`Tiled overlay manifest does not exist: ${resolvedPath}`);
	}

	let manifest;
	try {
		manifest = JSON.parse(readFileSync(resolvedPath, "utf8"));
	} catch (error) {
		fail(`Invalid tiled overlay manifest ${resolvedPath}: ${error.message}`);
	}
	if (manifest?.version !== TILED_OVERLAY_STORAGE_VERSION) {
		fail(`Unsupported tiled overlay storage version ${manifest?.version}: ${resolvedPath}`);
	}
	if (manifest.outputWidth !== outputWidth || manifest.outputHeight !== outputHeight) {
		fail(`Tiled overlay storage dimensions do not match the output: ${resolvedPath}`);
	}
	if (!isValidFrameRate(manifest.frameRate, frameRate)) {
		fail(`Tiled overlay storage frame rate does not match the output: ${resolvedPath}`);
	}
	if (
		!Number.isFinite(manifest.durationSec) ||
		manifest.durationSec <= 0 ||
		Math.abs(manifest.durationSec - durationSec) > 1 / frameRate
	) {
		fail(`Tiled overlay storage duration does not match the output: ${resolvedPath}`);
	}
	if (!Array.isArray(manifest.layers)) {
		fail(`Tiled overlay manifest requires a layers array: ${resolvedPath}`);
	}

	const layers = [];
	let previousOrder = -1;
	let previousId = "";
	for (const rawLayer of manifest.layers) {
		const id = typeof rawLayer?.id === "string" ? rawLayer.id : "";
		const layerPath = typeof rawLayer?.payloadPath === "string" ? rawLayer.payloadPath : "";
		if (!id || !layerPath) {
			fail(`Tiled overlay layer requires an id and payload path: ${resolvedPath}`);
		}
		const order = Number(rawLayer?.order);
		const x = Number(rawLayer?.x);
		const y = Number(rawLayer?.y);
		const width = Number(rawLayer?.width);
		const height = Number(rawLayer?.height);
		const layerFrameRate = Number(rawLayer?.frameRate);
		const layerDurationSec = Number(rawLayer?.durationSec);
		const frameCount = Number(rawLayer?.frameCount);
		const tileSize = Number(rawLayer?.tileSize);
		const pixelFormat = rawLayer?.pixelFormat;
		const payloadByteLength = Number(rawLayer?.payloadByteLength);
		const staticTiles = Array.isArray(rawLayer?.staticTiles) ? rawLayer.staticTiles : null;
		const frameDeltas = Array.isArray(rawLayer?.frameDeltas) ? rawLayer.frameDeltas : null;

		if (pixelFormat !== TILED_OVERLAY_PIXEL_FORMAT) {
			fail(`Tiled overlay layer ${id} must use RGBA tiles: ${resolvedPath}`);
		}
		if (tileSize !== TILED_OVERLAY_TILE_SIZE) {
			fail(
				`Tiled overlay layer ${id} must use ${TILED_OVERLAY_TILE_SIZE}px tiles: ${resolvedPath}`,
			);
		}
		if (
			![order, x, y, width, height, frameCount].every(isSafeInteger) ||
			order < 0 ||
			width <= 0 ||
			height <= 0 ||
			frameCount <= 0 ||
			x < 0 ||
			y < 0
		) {
			fail(`Invalid tiled overlay layer ${id}: ${resolvedPath}`);
		}
		if (x + width > outputWidth || y + height > outputHeight) {
			fail(`Tiled overlay layer ${id} exceeds the output canvas: ${resolvedPath}`);
		}
		if (!isValidFrameRate(layerFrameRate, frameRate)) {
			fail(`Tiled overlay layer ${id} has an incompatible frame rate: ${resolvedPath}`);
		}
		if (
			!Number.isFinite(layerDurationSec) ||
			layerDurationSec <= 0 ||
			Math.abs(layerDurationSec - durationSec) > 1 / frameRate
		) {
			fail(`Tiled overlay layer ${id} has an incompatible duration: ${resolvedPath}`);
		}
		const expectedFrameCount = Math.ceil(layerDurationSec * layerFrameRate);
		if (!isSafeInteger(frameCount) || frameCount < expectedFrameCount) {
			fail(`Tiled overlay layer ${id} does not contain enough frames: ${resolvedPath}`);
		}
		if (!isSafeInteger(payloadByteLength) || payloadByteLength < 0) {
			fail(`Tiled overlay layer ${id} has an invalid payload byte length: ${resolvedPath}`);
		}
		if (!Array.isArray(staticTiles)) {
			fail(`Tiled overlay layer ${id} requires a static tile base: ${resolvedPath}`);
		}
		if (!Array.isArray(frameDeltas)) {
			fail(`Tiled overlay layer ${id} requires frame delta records: ${resolvedPath}`);
		}
		if (order < previousOrder || (order === previousOrder && id <= previousId)) {
			fail(`Tiled overlay layers must be sorted by order then id: ${resolvedPath}`);
		}
		previousOrder = order;
		previousId = id;

		const tileCount = tileCountForSize(width, height);
		const seenStaticTiles = new Set();
		const seenPayloadRanges = new Set();
		const checkPayloadRange = (record) => {
			const rangeKey = `${record.byteOffset}:${record.byteLength}`;
			if (seenPayloadRanges.has(rangeKey)) {
				return `Tiled overlay layer ${id} duplicates tile payload bytes: ${resolvedPath}`;
			}
			seenPayloadRanges.add(rangeKey);
			return null;
		};
		for (const record of staticTiles) {
			const issue = validateTileRecord(record, id, tileCount, payloadByteLength);
			if (issue) {
				fail(issue);
			}
			if (seenStaticTiles.has(record.tileIndex)) {
				fail(
					`Tiled overlay layer ${id} emits duplicate static tile ${record.tileIndex}: ${resolvedPath}`,
				);
			}
			seenStaticTiles.add(record.tileIndex);
			const rangeIssue = checkPayloadRange(record);
			if (rangeIssue) {
				fail(rangeIssue);
			}
		}
		if (seenStaticTiles.size !== tileCount) {
			fail(
				`Tiled overlay layer ${id} does not fully define the static tile base: ${resolvedPath}`,
			);
		}
		let previousFrameIndex = -1;
		for (const delta of frameDeltas) {
			if (
				!isSafeInteger(delta?.frameIndex) ||
				delta.frameIndex < 0 ||
				delta.frameIndex >= frameCount
			) {
				fail(`Tiled overlay layer ${id} has an invalid delta frame index: ${resolvedPath}`);
			}
			if (delta.frameIndex <= previousFrameIndex) {
				fail(
					`Tiled overlay layer ${id} has unsorted or duplicate delta frame indices: ${resolvedPath}`,
				);
			}
			previousFrameIndex = delta.frameIndex;
			const seenDeltaTiles = new Set();
			for (const record of delta.changedTiles) {
				const issue = validateTileRecord(record, id, tileCount, payloadByteLength);
				if (issue) {
					fail(issue);
				}
				if (seenDeltaTiles.has(record.tileIndex)) {
					fail(
						`Tiled overlay layer ${id} repeats tile ${record.tileIndex} within a frame delta: ${resolvedPath}`,
					);
				}
				seenDeltaTiles.add(record.tileIndex);
				const rangeIssue = checkPayloadRange(record);
				if (rangeIssue) {
					fail(rangeIssue);
				}
			}
		}
		if (1 + frameDeltas.length > frameCount) {
			fail(`Tiled overlay layer ${id} has more state versions than frames: ${resolvedPath}`);
		}

		const resolvedLayerPath = resolve(layerPath);
		if (!existsSync(resolvedLayerPath)) {
			fail(`Tiled overlay layer ${id} does not exist: ${resolvedLayerPath}`);
		}
		const stat = statSync(resolvedLayerPath);
		if (stat.size < payloadByteLength) {
			fail(
				`Tiled overlay layer ${id} payload is truncated: expected at least ${payloadByteLength} bytes, received ${stat.size}`,
			);
		}
		layers.push({
			id,
			order,
			x,
			y,
			width,
			height,
			frameRate: layerFrameRate,
			durationSec: layerDurationSec,
			frameCount,
			tileSize,
			pixelFormat,
			payloadPath: resolvedLayerPath,
			payloadByteLength,
			staticTiles,
			frameDeltas,
		});
	}
	return layers;
}

/**
 * Additive renderer-derived throughput bookkeeping for a validated tiled layer.
 * Diagnostic only; cachedTileCount is reference bookkeeping, never a zero-copy
 * claim. Mirrors resolveNativeTiledOverlayMetrics on the TS side.
 */
export function resolveTiledOverlayLayerMetrics(layer) {
	const changedTileCount = layer.frameDeltas.reduce(
		(total, delta) => total + delta.changedTiles.length,
		0,
	);
	const uploadedTileCount = layer.staticTiles.length + changedTileCount;
	const tileCount = tileCountForSize(layer.width, layer.height);
	return {
		effectiveFrameCount: 1 + layer.frameDeltas.length,
		changedTileCount,
		uploadedTileCount,
		uploadedTileBytes: uploadedTileCount * TILED_OVERLAY_TILE_BYTE_SIZE,
		cachedTileCount: Math.max(0, tileCount * layer.frameCount - uploadedTileCount),
	};
}

/**
 * Conservative tiled-vs-raw eligibility decision. Returns null when eligible or
 * a reason string (small-layer | dense-frame-delta | payload-bytes-exceed-raw)
 * when the layer must keep the raw full-frame fallback. Mirrors
 * resolveNativeTiledOverlayRawFallbackReason on the TS side.
 */
export function resolveTiledOverlayRawFallbackReason(
	layer,
	metrics = resolveTiledOverlayLayerMetrics(layer),
) {
	const tileCount = tileCountForSize(layer.width, layer.height);
	if (tileCount < TILED_OVERLAY_MIN_TILE_COUNT) {
		return "small-layer";
	}
	for (const delta of layer.frameDeltas) {
		if (delta.changedTiles.length > tileCount * TILED_OVERLAY_MAX_CHANGED_TILE_FRACTION) {
			return "dense-frame-delta";
		}
	}
	const rawPhysicalBytes = layer.width * layer.height * 4 * layer.frameCount;
	if (metrics.uploadedTileBytes >= rawPhysicalBytes * TILED_OVERLAY_MAX_PAYLOAD_BYTES_FRACTION) {
		return "payload-bytes-exceed-raw";
	}
	return null;
}
