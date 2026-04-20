import type { FrameRenderer } from "./modernFrameRenderer";

export function syncVideoEffectsFilters(self: FrameRenderer): void {
	if (!self.videoEffectsContainer) {
		return;
	}

	self.videoEffectsContainer.filters =
		(self.config.zoomMotionBlur ?? 0) > 0 && self.motionBlurFilter
			? [self.motionBlurFilter]
			: null;
}