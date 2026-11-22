/** The renderer composites into an sRGB canvas, whose pixels are full-range RGB. */
export const EXPORT_CANVAS_COLOR_SPACE = {
	primaries: "bt709",
	transfer: "iec61966-2-1",
	matrix: "rgb",
	fullRange: true,
} as const satisfies VideoColorSpaceInit;

/**
 * H.264 encoders normally convert the canvas to video-range YUV. Use this only
 * when the encoder does not report its own output colour metadata.
 */
export const ENCODED_H264_COLOR_SPACE_FALLBACK = {
	primaries: "bt709",
	transfer: "bt709",
	matrix: "bt709",
	fullRange: false,
} as const satisfies VideoColorSpaceInit;
