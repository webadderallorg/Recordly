import { describe, expect, it } from "vitest";
import { DEFAULT_WEBCAM_MASK, type WebcamMaskSettings } from "@/components/video-editor/types";
import { isMaskRenderable, maskSettingsKey } from "./maskTexture";

// renderMaskToCanvas needs a real 2D canvas context, unavailable in vitest's
// node environment; these tests cover the pure cache-key and gating logic.

function mask(overrides: Partial<WebcamMaskSettings>): WebcamMaskSettings {
	return { ...DEFAULT_WEBCAM_MASK, ...overrides };
}

const TRIANGLE = [
	{ x: 0.1, y: 0.1 },
	{ x: 0.9, y: 0.1 },
	{ x: 0.5, y: 0.9 },
];

describe("maskSettingsKey", () => {
	it("is stable for identical shape-relevant settings", () => {
		const a = mask({ enabled: true, points: TRIANGLE });
		const b = mask({ enabled: false, points: TRIANGLE.map((p) => ({ ...p })) });
		expect(maskSettingsKey(a)).toBe(maskSettingsKey(b));
	});

	it("changes when any shape-relevant field changes", () => {
		const base = mask({ shape: "polygon", points: TRIANGLE });
		const baseKey = maskSettingsKey(base);
		expect(maskSettingsKey(mask({ ...base, shape: "rect" }))).not.toBe(baseKey);
		expect(
			maskSettingsKey(mask({ ...base, rect: { x: 0.1, y: 0, width: 0.9, height: 1 } })),
		).not.toBe(baseKey);
		expect(maskSettingsKey(mask({ ...base, cornerRadius: 0.5 }))).not.toBe(baseKey);
		expect(maskSettingsKey(mask({ ...base, feather: 0.7 }))).not.toBe(baseKey);
		expect(
			maskSettingsKey(mask({ ...base, points: [...TRIANGLE, { x: 0.2, y: 0.5 }] })),
		).not.toBe(baseKey);
		expect(
			maskSettingsKey(mask({ ...base, points: [TRIANGLE[1], TRIANGLE[0], TRIANGLE[2]] })),
		).not.toBe(baseKey);
	});

	it("changes when a point gains or moves bezier handles", () => {
		const base = mask({ shape: "polygon", points: TRIANGLE });
		const baseKey = maskSettingsKey(base);
		const withHandles = mask({
			...base,
			points: [
				{ ...TRIANGLE[0], inX: 0.05, inY: 0.2, outX: 0.3, outY: 0.05 },
				...TRIANGLE.slice(1),
			],
		});
		const withHandlesKey = maskSettingsKey(withHandles);
		expect(withHandlesKey).not.toBe(baseKey);
		const movedHandle = mask({
			...base,
			points: [
				{ ...TRIANGLE[0], inX: 0.06, inY: 0.2, outX: 0.3, outY: 0.05 },
				...TRIANGLE.slice(1),
			],
		});
		expect(maskSettingsKey(movedHandle)).not.toBe(withHandlesKey);
	});
});

describe("isMaskRenderable", () => {
	it("is false when disabled, regardless of shape", () => {
		expect(isMaskRenderable(mask({ enabled: false }))).toBe(false);
		expect(isMaskRenderable(mask({ enabled: false, shape: "polygon", points: TRIANGLE }))).toBe(
			false,
		);
	});

	it("is true for an enabled rect shape", () => {
		expect(isMaskRenderable(mask({ enabled: true, shape: "rect" }))).toBe(true);
	});

	it("requires >= 3 points for polygons", () => {
		expect(isMaskRenderable(mask({ enabled: true, shape: "polygon", points: [] }))).toBe(false);
		expect(
			isMaskRenderable(
				mask({ enabled: true, shape: "polygon", points: TRIANGLE.slice(0, 2) }),
			),
		).toBe(false);
		expect(isMaskRenderable(mask({ enabled: true, shape: "polygon", points: TRIANGLE }))).toBe(
			true,
		);
	});
});
