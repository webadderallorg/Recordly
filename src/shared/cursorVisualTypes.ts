// The order also defines the cursor indexes sent to native exporters.
export const CURSOR_VISUAL_TYPES = [
	"arrow",
	"text",
	"pointer",
	"crosshair",
	"open-hand",
	"closed-hand",
	"resize-ew",
	"resize-ns",
	"not-allowed",
	"move",
	"resize-nwse",
	"resize-nesw",
] as const;

export type CursorVisualType = (typeof CURSOR_VISUAL_TYPES)[number];

export function isCursorVisualType(value: unknown): value is CursorVisualType {
	return CURSOR_VISUAL_TYPES.some((type) => type === value);
}
