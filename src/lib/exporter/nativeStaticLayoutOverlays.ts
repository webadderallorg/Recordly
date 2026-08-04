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
