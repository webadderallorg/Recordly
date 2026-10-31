import { describe, expect, it } from "vitest";
import { getSceneEffectMetrics } from "./sceneEffects";

describe("getSceneEffectMetrics", () => {
	it("keeps blur proportional between preview and export widths", () => {
		const preview = getSceneEffectMetrics({
			viewportWidth: 640,
			backgroundBlur: 8,
			shadowIntensity: 0,
		});
		const exportFrame = getSceneEffectMetrics({
			viewportWidth: 1920,
			backgroundBlur: 8,
			shadowIntensity: 0,
		});

		expect(preview.backgroundBlurPx).toBe(8);
		expect(exportFrame.backgroundBlurPx).toBe(24);
		expect(exportFrame.backgroundBlurPx / 1920).toBe(preview.backgroundBlurPx / 640);
	});

	it("uses the same proportional shadow recipe at every width", () => {
		const preview = getSceneEffectMetrics({
			viewportWidth: 640,
			backgroundBlur: 0,
			shadowIntensity: 1,
		});
		const exportFrame = getSceneEffectMetrics({
			viewportWidth: 1280,
			backgroundBlur: 0,
			shadowIntensity: 1,
		});

		expect(preview.shadowFilter).toContain("12px 48px");
		expect(exportFrame.shadowFilter).toContain("24px 96px");
	});

	it("disables negative effect values", () => {
		const metrics = getSceneEffectMetrics({
			viewportWidth: 640,
			backgroundBlur: -4,
			shadowIntensity: -1,
		});

		expect(metrics.backgroundBlurPx).toBe(0);
		expect(metrics.backgroundOverscanPx).toBe(0);
		expect(metrics.shadowFilter).toBe("none");
	});
});
