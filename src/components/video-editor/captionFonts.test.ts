import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});

describe("bundled caption fonts", () => {
	it("overrides the old system-family TikTok setting while preserving other fonts", async () => {
		const { getCaptionFontFamily } = await import("./captionFonts");
		expect(
			getCaptionFontFamily({ style: "tiktok", fontFamily: "Helvetica" }, "sans-serif"),
		).toBe('"TikTok Sans", sans-serif');
		expect(getCaptionFontFamily({ style: "paper", fontFamily: "Custom Font" })).toBe(
			"Custom Font",
		);
	});

	it("waits for decoding before registering the font and shares one load", async () => {
		let complete!: () => void;
		const ready = new Promise<void>((resolve) => {
			complete = resolve;
		});
		const add = vi.fn();
		const load = vi.fn(async function (this: unknown) {
			await ready;
			return this;
		});
		const FontFaceMock = vi.fn(
			class {
				load = load;
			},
		);
		vi.stubGlobal("document", { fonts: { add } });
		vi.stubGlobal("FontFace", FontFaceMock);
		const { ensureCaptionFontLoaded } = await import("./captionFonts");
		const settings = { style: "tiktok" as const, fontFamily: "Helvetica" };
		const first = ensureCaptionFontLoaded(settings);
		expect(ensureCaptionFontLoaded(settings)).toBe(first);
		expect(add).not.toHaveBeenCalled();
		complete();
		await first;
		expect(FontFaceMock).toHaveBeenCalledTimes(1);
		expect(load).toHaveBeenCalledTimes(1);
		expect(add).toHaveBeenCalledTimes(1);
		await ensureCaptionFontLoaded(settings);
		expect(load).toHaveBeenCalledTimes(1);
	});

	it("retries a failed font load instead of silently exporting a fallback", async () => {
		const add = vi.fn();
		const load = vi
			.fn()
			.mockRejectedValueOnce(new Error("Asset unavailable"))
			.mockResolvedValueOnce({ family: "TikTok Sans" });
		vi.stubGlobal("document", { fonts: { add } });
		vi.stubGlobal(
			"FontFace",
			class {
				load = load;
			},
		);
		const { ensureCaptionFontLoaded } = await import("./captionFonts");
		const settings = { style: "tiktok" as const, fontFamily: "Helvetica" };
		await expect(ensureCaptionFontLoaded(settings)).rejects.toThrow("Asset unavailable");
		expect(add).not.toHaveBeenCalled();
		await ensureCaptionFontLoaded(settings);
		expect(load).toHaveBeenCalledTimes(2);
		expect(add).toHaveBeenCalledTimes(1);
	});

	it("does not require browser font APIs for other caption styles", async () => {
		const { ensureCaptionFontLoaded } = await import("./captionFonts");
		await ensureCaptionFontLoaded({ style: "classic", fontFamily: "Helvetica" });
	});
});
