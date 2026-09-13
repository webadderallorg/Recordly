import { describe, expect, it } from "vitest";
import { DEFAULT_AUTO_CAPTION_SETTINGS } from "@/components/video-editor/types";
import { normalizeAutoCaptionSettings } from "./captionSettings";

describe("normalizeAutoCaptionSettings", () => {
	it("returns defaults for missing settings", () => {
		expect(normalizeAutoCaptionSettings(undefined)).toEqual(DEFAULT_AUTO_CAPTION_SETTINGS);
	});

	it("keeps a saved catalog font instead of resetting it", () => {
		const settings = normalizeAutoCaptionSettings({ fontId: "montserrat", fontWeight: 800 });

		expect(settings.fontId).toBe("montserrat");
		expect(settings.fontWeight).toBe(800);
	});

	it("maps legacy projects with a free-form font family to the default font", () => {
		const settings = normalizeAutoCaptionSettings({
			fontFamily: '"SF Pro Text", "Helvetica Neue", sans-serif',
			inactiveTextColor: "#A3A3A3",
			fontSize: 40,
		});

		expect(settings.fontId).toBe(DEFAULT_AUTO_CAPTION_SETTINGS.fontId);
		expect(settings.fontSize).toBe(40);
		expect(settings).not.toHaveProperty("fontFamily");
		expect(settings).not.toHaveProperty("inactiveTextColor");
	});

	it("rejects unknown enum values and clamps numeric ranges", () => {
		const settings = normalizeAutoCaptionSettings({
			verticalPosition: "floating",
			horizontalAlign: "justify",
			highlightMode: "sparkle",
			fontWeight: 1200,
			outlineWidth: -3,
			shadowOpacity: 4,
			fontSize: 500,
		});

		expect(settings.verticalPosition).toBe("bottom");
		expect(settings.horizontalAlign).toBe("center");
		expect(settings.highlightMode).toBe(DEFAULT_AUTO_CAPTION_SETTINGS.highlightMode);
		expect(settings.fontWeight).toBe(900);
		expect(settings.outlineWidth).toBe(0);
		expect(settings.shadowOpacity).toBe(1);
		expect(settings.fontSize).toBe(72);
	});

	it("accepts the new placement, outline and highlight options", () => {
		const settings = normalizeAutoCaptionSettings({
			verticalPosition: "top",
			horizontalAlign: "left",
			uppercase: true,
			outlineWidth: 4,
			outlineColor: "#112233",
			highlightMode: "pill",
			highlightColor: "#22C55E",
		});

		expect(settings).toMatchObject({
			verticalPosition: "top",
			horizontalAlign: "left",
			uppercase: true,
			outlineWidth: 4,
			outlineColor: "#112233",
			highlightMode: "pill",
			highlightColor: "#22C55E",
		});
	});
});

describe("normalizeAutoCaptionSettings emphasis options", () => {
	it("keeps a valid accent rule and emphasis color", () => {
		const settings = normalizeAutoCaptionSettings({
			accentRule: "longest-word",
			emphasisColor: "#38BDF8",
		});

		expect(settings.accentRule).toBe("longest-word");
		expect(settings.emphasisColor).toBe("#38BDF8");
	});

	it("falls back to no automatic accent for unknown rules", () => {
		expect(normalizeAutoCaptionSettings({ accentRule: "every-word" }).accentRule).toBe("none");
	});
});
