import type { ExportMp4FrameRate, ExportQuality } from "@/lib/exporter";
import { type AspectRatio, getAspectRatioValue } from "@/utils/aspectRatioUtils";

export type Mp4SupportProbeSnapshot = {
	sourceWidth: number;
	sourceHeight: number;
	targetWidth: number;
	targetHeight: number;
	aspectRatio: AspectRatio;
	frameRate: ExportMp4FrameRate;
};

export function shouldDebounceMp4SupportProbe(
	previous: Mp4SupportProbeSnapshot | null,
	current: Mp4SupportProbeSnapshot,
): boolean {
	if (
		!previous ||
		current.aspectRatio !== "native" ||
		previous.aspectRatio !== current.aspectRatio ||
		previous.frameRate !== current.frameRate ||
		previous.sourceWidth !== current.sourceWidth ||
		previous.sourceHeight !== current.sourceHeight
	) {
		return false;
	}

	return (
		previous.targetWidth !== current.targetWidth ||
		previous.targetHeight !== current.targetHeight
	);
}

function normalizeEvenDimension(value: number): number {
	return Math.max(2, Math.floor(value / 2) * 2);
}

function fitAspectRatioWithinBounds(
	maxWidth: number,
	maxHeight: number,
	aspectRatioValue: number,
): { width: number; height: number } {
	const safeMaxWidth = normalizeEvenDimension(maxWidth);
	const safeMaxHeight = normalizeEvenDimension(maxHeight);
	const safeAspectRatio =
		Number.isFinite(aspectRatioValue) && aspectRatioValue > 0 ? aspectRatioValue : 16 / 9;

	if (safeMaxWidth / safeMaxHeight > safeAspectRatio) {
		const height = safeMaxHeight;
		const width = normalizeEvenDimension(height * safeAspectRatio);
		return { width: Math.min(width, safeMaxWidth), height };
	}

	const width = safeMaxWidth;
	const height = normalizeEvenDimension(width / safeAspectRatio);
	return { width, height: Math.min(height, safeMaxHeight) };
}

export function calculateMp4SourceDimensions(
	sourceWidth: number,
	sourceHeight: number,
	aspectRatio: AspectRatio,
	cropRegion?: { width: number; height: number },
): { width: number; height: number } {
	const useCroppedBounds = aspectRatio === "native";
	const safeSourceWidth = normalizeEvenDimension(
		sourceWidth * (useCroppedBounds ? (cropRegion?.width ?? 1) : 1),
	);
	const safeSourceHeight = normalizeEvenDimension(
		sourceHeight * (useCroppedBounds ? (cropRegion?.height ?? 1) : 1),
	);
	const sourceAspectRatio = safeSourceHeight > 0 ? safeSourceWidth / safeSourceHeight : 16 / 9;
	const aspectRatioValue = getAspectRatioValue(aspectRatio, sourceAspectRatio);

	if (aspectRatio === "native") {
		return { width: safeSourceWidth, height: safeSourceHeight };
	}

	const longSide = Math.max(safeSourceWidth, safeSourceHeight);
	const shortSide = Math.min(safeSourceWidth, safeSourceHeight);
	const maxWidth = aspectRatioValue >= 1 ? longSide : shortSide;
	const maxHeight = aspectRatioValue >= 1 ? shortSide : longSide;

	return fitAspectRatioWithinBounds(maxWidth, maxHeight, aspectRatioValue);
}

export function calculateMp4ExportDimensions(
	baseWidth: number,
	baseHeight: number,
	quality: ExportQuality,
	custom?: { width: number; height: number } | null,
): { width: number; height: number } {
	const width = normalizeEvenDimension(baseWidth);
	const height = normalizeEvenDimension(baseHeight);
	if (quality === "custom") {
		if (!isValidCustomExportResolution(custom))
			throw new Error("Enter even dimensions between 2 and 8192 pixels.");
		return { width: custom!.width, height: custom!.height };
	}
	if (quality === "source") {
		return { width, height };
	}

	// Resolution tiers use the longest canvas edge, including square, portrait,
	// and custom ratios. Fixed tiers may upscale; Original preserves source size.
	const longestEdge = { hd: 1280, medium: 1920, good: 2560, high: 3840 }[quality];
	const scale = longestEdge / Math.max(width, height);
	return {
		width: width >= height ? longestEdge : normalizeEvenDimension(width * scale),
		height: height >= width ? longestEdge : normalizeEvenDimension(height * scale),
	};
}

export function isValidCustomExportResolution(
	value: { width: number; height: number } | null | undefined,
): boolean {
	return (
		!!value &&
		[value.width, value.height].every(
			(n) => Number.isSafeInteger(n) && n >= 2 && n <= 8192 && n % 2 === 0,
		)
	);
}

export function fitCustomExportResolution(
	resolution: { width: number; height: number },
	canvas: { width: number; height: number },
) {
	const edge = Math.max(resolution.width, resolution.height);
	const scale = edge / Math.max(canvas.width, canvas.height);
	return {
		width: canvas.width >= canvas.height ? edge : normalizeEvenDimension(canvas.width * scale),
		height:
			canvas.height >= canvas.width ? edge : normalizeEvenDimension(canvas.height * scale),
	};
}
