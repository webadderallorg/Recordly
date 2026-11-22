import { MotionBlurFilter } from "./motionBlurFilter";
import { ZoomBlurFilter } from "./zoomBlurFilter";

export function createVideoBlurFilters() {
	const zoom = new ZoomBlurFilter({ strength: 0, maxKernelSize: 32 });
	const motion = new MotionBlurFilter({ velocity: [0, 0], kernelSize: 5, offset: 0 });
	zoom.antialias = "on";
	motion.antialias = "on";
	return { zoom, motion };
}
