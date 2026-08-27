import { describe, expect, it } from "vitest";
import { getInteractiveBlurFrameKey } from "./WebcamBackgroundBlurPreview";

describe("getInteractiveBlurFrameKey", () => {
	it("reuses frames within the same 15 FPS preview interval", () => {
		expect(getInteractiveBlurFrameKey("camera-1", 1)).toBe("camera-1:15");
		expect(getInteractiveBlurFrameKey("camera-1", 1.05)).toBe("camera-1:15");
		expect(getInteractiveBlurFrameKey("camera-1", 1.07)).toBe("camera-1:16");
	});

	it("keeps different webcam sources isolated", () => {
		expect(getInteractiveBlurFrameKey("camera-1", 1)).not.toBe(
			getInteractiveBlurFrameKey("camera-2", 1),
		);
	});
});
