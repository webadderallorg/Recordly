export type HudWindowLayoutMode = "legacy" | "shape" | "grow";

let hudWindowLayoutMode: HudWindowLayoutMode = "legacy";

/**
 * Set once the renderer learns the HUD window's sizing mode: "shape" = X11
 * shape carving (constant tall window), "grow" = native-Wayland-style grow-
 * downward (bar anchored to the window's top), "legacy" = fixed window.
 * Popovers read this to open downward in grow mode and to pre-grow the
 * window before mounting.
 */
export function setHudWindowLayoutMode(mode: HudWindowLayoutMode): void {
	hudWindowLayoutMode = mode;
}

export function getHudWindowLayoutMode(): HudWindowLayoutMode {
	return hudWindowLayoutMode;
}

export function isHudShapeMode(): boolean {
	return hudWindowLayoutMode === "shape";
}

export function isHudGrowMode(): boolean {
	return hudWindowLayoutMode === "grow";
}
