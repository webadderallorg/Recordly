import { PROJECT_THUMBNAIL_HEIGHT, PROJECT_THUMBNAIL_WIDTH } from "./projectThumbnail";

/** Render the saved composition at its own aspect ratio before cropping the card. */
export function getProjectThumbnailRenderSize(aspectRatio: number) {
	const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 16 / 9;
	const width = Math.max(PROJECT_THUMBNAIL_WIDTH, PROJECT_THUMBNAIL_HEIGHT * ratio);
	const height = width / ratio;
	// Custom aspect ratios must not allocate an unbounded GPU surface.
	const scale = Math.min(1, 4096 / Math.max(width, height));
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}

/** Cover the entire card with the composition, preserving its deliberate padding. */
export function captureProjectThumbnailCanvas(
	source: CanvasImageSource,
	width: number,
	height: number,
): string {
	const canvas = document.createElement("canvas");
	canvas.width = PROJECT_THUMBNAIL_WIDTH;
	canvas.height = PROJECT_THUMBNAIL_HEIGHT;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Thumbnail canvas unavailable");
	const scale = Math.max(canvas.width / width, canvas.height / height);
	const cropWidth = canvas.width / scale;
	const cropHeight = canvas.height / scale;
	context.drawImage(
		source,
		(width - cropWidth) / 2,
		(height - cropHeight) / 2,
		cropWidth,
		cropHeight,
		0,
		0,
		canvas.width,
		canvas.height,
	);
	return canvas.toDataURL("image/png");
}
