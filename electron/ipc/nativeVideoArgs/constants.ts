export const NATIVE_EXPORT_INPUT_BYTES_PER_PIXEL = 4;

export const MIN_EDITED_TRACK_TEMPO_SPEED = 0.5;

export const MAX_EDITED_TRACK_TEMPO_SPEED = 2;

export const FFMPEG_BT709_VIDEO_COLOR_ARGS = [
	"-colorspace",
	"bt709",
	"-color_primaries",
	"bt709",
	"-color_trc",
	"bt709",
	"-color_range",
	"tv",
] as const;

export const FFMPEG_AUTO_TO_VIDEO_RANGE_FILTER =
	"scale=in_range=auto:out_range=tv:sws_dither=bayer";

export const FFMPEG_AUTO_TO_FULL_RANGE_FILTER = "scale=in_range=auto:out_range=full";

export const FFMPEG_FULL_TO_VIDEO_RANGE_FILTER =
	"scale=in_range=full:out_range=tv:sws_dither=bayer";
