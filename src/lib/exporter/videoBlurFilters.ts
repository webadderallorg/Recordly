import { MotionBlurFilter } from "pixi-filters/motion-blur";
import { ZoomBlurFilter } from "pixi-filters/zoom-blur";

export function createVideoBlurFilters() {
	const zoom = new ZoomBlurFilter({ strength: 0, maxKernelSize: 13 });
	const motion = new MotionBlurFilter([0, 0], 5, 0);
	// Filter textures default to no MSAA, losing coverage at rounded mask edges.
	zoom.antialias = "on";
	motion.antialias = "on";
	return { zoom, motion };
}
