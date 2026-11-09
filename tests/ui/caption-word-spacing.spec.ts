import { expect, test } from "@playwright/test";

test("word highlighting preserves every word's position and size", async ({ page }, testInfo) => {
	test.setTimeout(120000);
	await page.goto("/tests/ui/caption-preview.html?style=classic");
	const caption = page.getByRole("button", { name: "Edit current caption", exact: true });
	for (const style of ["Classic", "TikTok", "Karaoke", "Minimal", "Neon", "Paper"]) {
		await page.goto(`/tests/ui/caption-preview.html?style=${style.toLowerCase()}`);
		await page.evaluate(() => document.fonts.ready);
		const samples = [];
		for (const [time, activeWord] of [
			[400, "Follow"],
			[700, "every"],
			[1200, "word"],
		] as const) {
			await page.getByRole("spinbutton", { name: "Time", exact: true }).fill(String(time));
			await expect(caption.locator('[data-caption-word-state="active"]')).toHaveText(
				style === "TikTok" ? activeWord.toUpperCase() : activeWord,
			);
			samples.push(
				await caption.locator("[data-caption-word-state]").evaluateAll((words) =>
					words.map((word) => {
						const rect = word
							.querySelector("[data-caption-word-visual]")!
							.getBoundingClientRect();
						return {
							x: rect.x,
							y: rect.y,
							width: rect.width,
							height: rect.height,
						};
					}),
				),
			);
		}
		for (let index = 0; index < 3; index++) {
			const before = samples[0][index];
			for (const words of samples.slice(1)) {
				for (const axis of ["x", "y", "width", "height"] as const) {
					expect(words[index][axis], `${style}: word ${index} ${axis}`).toBeCloseTo(
						before[axis],
						2,
					);
				}
			}
		}
	}
	await page.goto("/tests/ui/caption-preview.html?style=classic");
	await page.screenshot({ path: testInfo.outputPath("independent-caption-highlight.png") });
});

test("export highlighting preserves every word's position and size", async ({ page }) => {
	await page.goto("/tests/ui/caption-preview.html?style=classic");
	await page.evaluate(() => document.fonts.ready);
	const samples = await page.evaluate(async () => {
		const rendererPath = "/src/lib/exporter/captionText.ts";
		const presetsPath = "/src/components/video-editor/captionPresets.ts";
		const layoutPath = "/src/components/video-editor/captionLayout.ts";
		const typesPath = "/src/components/video-editor/types.ts";
		const { drawCaptionLine } = await import(rendererPath);
		const { CAPTION_PRESETS, applyCaptionPreset } = await import(presetsPath);
		const { buildActiveCaptionLayout } = await import(layoutPath);
		const { DEFAULT_AUTO_CAPTION_SETTINGS, getDefaultCaptionFontFamily } = await import(
			typesPath
		);
		const cues = [
			{
				id: "spacing",
				startMs: 0,
				endMs: 1500,
				text: "Follow every word",
				words: [
					{ text: "Follow", startMs: 0, endMs: 400 },
					{ text: "every", startMs: 500, endMs: 900, leadingSpace: true },
					{ text: "word", startMs: 1000, endMs: 1400, leadingSpace: true },
				],
			},
		];
		return CAPTION_PRESETS.map((preset: { id: string; fontWeight: number }) => {
			const settings = applyCaptionPreset(DEFAULT_AUTO_CAPTION_SETTINGS, preset.id);
			const family = getDefaultCaptionFontFamily();
			const ctx = document.createElement("canvas").getContext("2d")!;
			ctx.font = `${preset.fontWeight} 30px ${family}`;
			let positions: Record<string, { x: number; y: number; width: number; scaleY: number }> =
				{};
			ctx.fillText = (text, x, y) => {
				const transform = ctx.getTransform();
				const point = transform.transformPoint({ x, y });
				positions[text] = {
					x: point.x,
					y: point.y,
					width: ctx.measureText(text).width * transform.a,
					scaleY: transform.d,
				};
			};
			const frames = [400, 700, 1200].map((timeMs) => {
				positions = {};
				const layout = buildActiveCaptionLayout({
					cues,
					timeMs,
					settings,
					maxWidthPx: 700,
					measureText: (text: string) => ctx.measureText(text).width,
				});
				drawCaptionLine(ctx, layout.visibleLines[0], settings, 30, family, 480, 200, true);
				return positions;
			});
			return { style: preset.id, frames };
		});
	});
	for (const { style, frames } of samples) {
		if (style === "reveal" || style === "serif") {
			expect(frames.map((frame) => Object.keys(frame).length)).toEqual([1, 2, 3]);
			for (const [word, last] of Object.entries(frames[2])) {
				for (const frame of frames) {
					if (!frame[word]) continue;
					for (const axis of ["y", "width", "scaleY"] as const)
						expect(frame[word][axis], `${style}: ${word} ${axis}`).toBeCloseTo(
							last[axis],
							5,
						);
				}
			}
			expect(frames[2].Follow.x).toBeLessThan(frames[0].Follow.x);
			continue;
		}
		for (const sourceWord of ["Follow", "every", "word"]) {
			const word = style === "tiktok" ? sourceWord.toUpperCase() : sourceWord;
			for (const frame of frames.slice(1)) {
				for (const axis of ["x", "y", "width", "scaleY"] as const) {
					expect(frame[word][axis], `${style}: ${word} ${axis}`).toBeCloseTo(
						frames[0][word][axis],
						5,
					);
				}
			}
		}
	}
});
