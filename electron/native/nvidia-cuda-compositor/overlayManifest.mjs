// Renderer-prepared transparent RGBA overlay sidecar manifest reader for the
// NVIDIA CUDA compositor wrapper (run-mp4-pipeline.mjs).
//
// Manifest layers carry a logical frameCount plus an optional
// effectiveFrameCount. When renderer-side deduplication truncated an identical
// suffix, the sidecar physically stores only effectiveFrameCount frames
// (1 <= effectiveFrameCount <= frameCount) and the final physical frame repeats
// for output indices [effectiveFrameCount, frameCount). Byte validation and the
// native --overlay descriptor must therefore use the physical frame count while
// the returned metadata/summary keeps the logical count. Manifests without
// effectiveFrameCount are fully dynamic layers and behave exactly as before.
//
// Two layer kinds are accepted:
//   - "rgba" (default when `kind` is absent): a fixed-position raw RGBA overlay
//     sidecar with a single `path`. Behavior is unchanged. Every layer carries
//     its manifest `kind` and `order` (a safe-integer manifest order, otherwise
//     a deterministic default), so classification and z-order survive JS-side
//     filtering and the native descriptor keeps the renderer's global z-order.
//   - "cursor-sprite": a tightly packed raw RGBA frame strip at `path` (one
//     width*height*4 frame per output frame) whose per-frame top-left {x,y}
//     position comes from a JSON `positionsPath` sidecar (exactly frameCount
//     integer entries, top-down output pixels). Base x/y are 0 and ignored;
//     positions are clamped to the output canvas and malformed/missing/truncated
//     input fails closed so the cursor is never silently omitted.
// Unknown layer kinds are rejected rather than dropped.

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

function fail(message) {
	throw new Error(message);
}

// Clamps a top-left position so a partially off-canvas sprite keeps its visible
// part on screen. Sprite dimensions must already be validated against the
// canvas before clamping.
function clampPosition(position, spriteWidth, spriteHeight, outputWidth, outputHeight) {
	const maxX = Math.max(0, outputWidth - spriteWidth);
	const maxY = Math.max(0, outputHeight - spriteHeight);
	return {
		x: Math.max(0, Math.min(maxX, Number(position.x))),
		y: Math.max(0, Math.min(maxY, Number(position.y))),
	};
}

function readCursorSpritePositions(
	positionsPath,
	frameCount,
	outputSize,
	layerId,
	spriteWidth,
	spriteHeight,
) {
	const resolvedPositionsPath = resolve(positionsPath);
	if (!existsSync(resolvedPositionsPath)) {
		fail(`Cursor-sprite layer ${layerId} positions do not exist: ${resolvedPositionsPath}`);
	}

	let parsed;
	try {
		parsed = JSON.parse(readFileSync(resolvedPositionsPath, "utf8"));
	} catch (error) {
		fail(`Invalid cursor-sprite positions ${resolvedPositionsPath}: ${error.message}`);
	}
	const positions = Array.isArray(parsed) ? parsed : parsed?.positions;
	if (!Array.isArray(positions)) {
		fail(
			`Cursor-sprite layer ${layerId} positions must be a JSON array of {x,y} objects: ` +
				resolvedPositionsPath,
		);
	}
	if (positions.length !== frameCount) {
		fail(
			`Cursor-sprite layer ${layerId} positions must contain exactly one {x,y} per output ` +
				`frame: expected ${frameCount}, received ${positions.length}`,
		);
	}

	const { outputWidth, outputHeight } = outputSize;
	return positions.map((position, index) => {
		const x = Number(position?.x);
		const y = Number(position?.y);
		if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
			fail(`Cursor-sprite layer ${layerId} has a malformed position at frame ${index}`);
		}
		// Clamp the visible part of a partially off-canvas cursor rather than
		// silently dropping it.
		return clampPosition({ x, y }, spriteWidth, spriteHeight, outputWidth, outputHeight);
	});
}

export function readOverlayManifest(manifestPath, outputSize) {
	if (!manifestPath) {
		return [];
	}
	const { outputWidth, outputHeight } = outputSize;
	const resolvedPath = resolve(manifestPath);
	if (!existsSync(resolvedPath)) {
		fail(`Overlay manifest does not exist: ${resolvedPath}`);
	}

	let manifest;
	try {
		manifest = JSON.parse(readFileSync(resolvedPath, "utf8"));
	} catch (error) {
		fail(`Invalid overlay manifest ${resolvedPath}: ${error.message}`);
	}
	if (!Array.isArray(manifest.layers)) {
		fail(`Overlay manifest requires a layers array: ${resolvedPath}`);
	}

	const layers = [];
	for (const layer of manifest.layers) {
		const id = typeof layer?.id === "string" ? layer.id : "";
		const kind = layer?.kind ?? "rgba";
		const layerPath = typeof layer?.path === "string" ? layer.path : "";
		const x = Number(layer?.x);
		const y = Number(layer?.y);
		const width = Number(layer?.width);
		const height = Number(layer?.height);
		const frameCount = Number(layer?.frameCount);
		const effectiveFrameCount =
			layer?.effectiveFrameCount === undefined || layer?.effectiveFrameCount === null
				? null
				: Number(layer.effectiveFrameCount);
		if (!id || !layerPath) {
			fail(`Overlay manifest layer requires an id and path: ${resolvedPath}`);
		}
		if (
			![x, y, width, height, frameCount].every(Number.isSafeInteger) ||
			width <= 0 ||
			height <= 0 ||
			frameCount <= 0 ||
			x < 0 ||
			y < 0
		) {
			fail(`Invalid overlay manifest layer ${id}: ${resolvedPath}`);
		}
		if (kind === "cursor-sprite") {
			if (width > outputWidth || height > outputHeight) {
				fail(`Cursor-sprite layer ${id} exceeds the output canvas: ${resolvedPath}`);
			}
			if (effectiveFrameCount !== null) {
				fail(
					`Cursor-sprite layer ${id} does not support effectiveFrameCount: ${resolvedPath}`,
				);
			}
			// Base x/y are always 0 for a cursor-sprite; positions carry the
			// per-frame top-left.
			const positionsPath =
				typeof layer?.positionsPath === "string" ? layer.positionsPath : "";
			if (!positionsPath) {
				fail(`Cursor-sprite layer ${id} requires a positionsPath: ${resolvedPath}`);
			}
			const positions = readCursorSpritePositions(
				positionsPath,
				frameCount,
				outputSize,
				id,
				width,
				height,
			);
			const resolvedLayerPath = resolve(layerPath);
			if (!existsSync(resolvedLayerPath)) {
				fail(`Cursor-sprite layer ${id} does not exist: ${resolvedLayerPath}`);
			}
			const expectedBytes = width * height * 4 * frameCount;
			const stat = statSync(resolvedLayerPath);
			if (stat.size < expectedBytes) {
				fail(
					`Cursor-sprite layer ${id} is truncated: expected at least ${expectedBytes} ` +
						`bytes, received ${stat.size}`,
				);
			}
			// Cursor sprite layers blend above the fixed-position overlays; a
			// manifest order takes precedence, otherwise default to a high value so
			// the cursor stays sharp/topmost.
			const order = Number.isSafeInteger(Number(layer?.order)) ? Number(layer.order) : 10000;
			layers.push({
				id,
				kind,
				order,
				path: resolvedLayerPath,
				positionsPath: resolve(positionsPath),
				x: 0,
				y: 0,
				width,
				height,
				frameCount,
				positions,
			});
			continue;
		}
		if (kind !== "rgba") {
			fail(`Overlay manifest layer ${id} has an unexpected kind "${kind}": ${resolvedPath}`);
		}
		if (effectiveFrameCount !== null) {
			// Mirror the renderer contract (validateNativeStaticLayoutOverlayLayer):
			// the physical sidecar count must be a positive integer no greater than
			// the logical count. Malformed values fail here with the same generic
			// invalid-layer message instead of a confusing truncation error.
			if (
				!Number.isSafeInteger(effectiveFrameCount) ||
				effectiveFrameCount < 1 ||
				effectiveFrameCount > frameCount
			) {
				fail(`Invalid overlay manifest layer ${id}: ${resolvedPath}`);
			}
		}
		if (x + width > outputWidth || y + height > outputHeight) {
			fail(`Overlay layer ${id} exceeds the output canvas: ${resolvedPath}`);
		}
		const resolvedLayerPath = resolve(layerPath);
		if (!existsSync(resolvedLayerPath)) {
			fail(`Overlay layer ${id} does not exist: ${resolvedLayerPath}`);
		}
		const physicalFrameCount = effectiveFrameCount ?? frameCount;
		const expectedBytes = width * height * 4 * physicalFrameCount;
		const stat = statSync(resolvedLayerPath);
		if (stat.size < expectedBytes) {
			fail(
				`Overlay layer ${id} is truncated: expected at least ${expectedBytes} bytes, received ${stat.size}`,
			);
		}
		// A manifest order takes precedence; otherwise default to the layer's
		// position in the sorted manifest so relative z-order survives even when
		// the producer omits the field (mirrors the native --overlay insertion
		// default). Mixed rgba/cursor-sprite manifests keep ascending z-order and
		// the cursor-sprite default (10000) stays above the fixed-position layers.
		const order = Number.isSafeInteger(Number(layer?.order))
			? Number(layer.order)
			: layers.length;
		layers.push({
			id,
			kind,
			order,
			path: resolvedLayerPath,
			x,
			y,
			width,
			height,
			frameCount,
			...(effectiveFrameCount !== null ? { effectiveFrameCount } : {}),
		});
	}
	return layers;
}

// Sorts overlay layers by ascending manifest z-order (order, then id) so the
// consumer's kind filters and the native descriptor always see the renderer's
// global z-order regardless of the manifest's physical order. Mirrors the sort
// used by the renderer-side native arg builders (order asc, then id
// localeCompare). Cursor-sprite layers keep their high default order (10000)
// when the producer omits the field, so they stay above fixed rgba layers even
// when the manifest lists them first.
export function sortOverlayLayersByOrder(layers) {
	return [...layers].sort(
		(left, right) => left.order - right.order || left.id.localeCompare(right.id),
	);
}
