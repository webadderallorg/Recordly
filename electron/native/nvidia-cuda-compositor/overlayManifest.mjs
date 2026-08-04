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

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

function fail(message) {
	throw new Error(message);
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
		layers.push({
			id,
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
