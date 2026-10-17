import { getMaxTexturesPerBatch } from "pixi.js";

/**
 * Pixi caches a single module-level batch shader sized by the texture limit of the first
 * renderer created in the page. The editor preview initializes WebGL first, so a WebGPU
 * export renderer with a different limit (e.g. Mesa: WebGL 32 vs WebGPU 16) reuses a shader
 * whose bind group layout expects more textures than the batch provides, crashing with
 * "Cannot read properties of undefined (reading '_resourceType')" on the first frame.
 */
export function getBatchTextureLimitMismatchMessage(
	webgpuMaxBatchableTextures: number,
	webglMaxBatchableTextures: number,
): string | null {
	if (webgpuMaxBatchableTextures === webglMaxBatchableTextures) {
		return null;
	}
	return `WebGPU batch texture limit (${webgpuMaxBatchableTextures}) differs from WebGL (${webglMaxBatchableTextures}); the shared Pixi batch shader would be incompatible`;
}

export function readWebGlMaxBatchableTextures(): number | null {
	try {
		return getMaxTexturesPerBatch();
	} catch (error) {
		console.warn("[pixiBatchTextureLimits] Unable to read WebGL batch texture limit:", error);
		return null;
	}
}
