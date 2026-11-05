import { expect, test, type Page } from "@playwright/test";

async function seek(page: Page, timeMs: number) {
	await page.getByRole("spinbutton", { name: "Time", exact: true }).fill(String(timeMs));
}

test("fixed-size word highlights follow speech without reviving captions after a pause", async ({
	page,
}, testInfo) => {
	test.setTimeout(120000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/tests/ui/caption-preview.html");
	const caption = page.getByRole("button", { name: "Edit current caption", exact: true });
	const highlight = caption.locator("[data-caption-word-highlight]");
	await seek(page, 700);
	await expect(caption).toHaveText("Follow every word");
	await expect(highlight).toHaveCount(1);
	await expect(caption.locator('[data-caption-word-state="active"]')).toHaveText("every");
	await expect(highlight).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
	await expect(caption).toHaveCSS("background-color", "rgba(0, 0, 0, 0.7)");
	const initialBox = await caption.boundingBox();
	const typography = await caption.evaluate((node) => {
		const active = node.querySelector<HTMLElement>("[data-caption-word-highlight]")!;
		const inactive = node.querySelector<HTMLElement>('[data-caption-word-state="spoken"]')!;
		const highlightBox = active.querySelector<HTMLElement>('[aria-hidden="true"]')!;
		const a = getComputedStyle(active),
			b = getComputedStyle(inactive);
		const visual = active.querySelector<HTMLElement>("[data-caption-word-visual]")!;
		const canvas = document.createElement("canvas"),
			ctx = canvas.getContext("2d")!;
		ctx.font = `${b.fontWeight} ${b.fontSize} ${b.fontFamily}`;
		const expectedSpace = ctx.measureText(" ").width;
		const gap = active.getBoundingClientRect().left - inactive.getBoundingClientRect().right;
		return {
			visualScale: new DOMMatrix(getComputedStyle(visual).transform).a,
			activeTransform: a.transform,
			verticalAlign: a.verticalAlign,
			radius: parseFloat(getComputedStyle(highlightBox).borderRadius),
			highlightHeight: highlightBox.getBoundingClientRect().height,
			gap,
			expectedSpace,
		};
	});
	expect(typography.visualScale).toBe(1);
	expect(typography.activeTransform).toBe("none");
	expect(typography.verticalAlign).toBe("baseline");
	expect(typography.radius).toBeLessThan(typography.highlightHeight / 4);
	expect(typography.gap).toBeCloseTo(typography.expectedSpace, 0);
	await page.screenshot({ path: testInfo.outputPath("word-highlight-preview.png") });
	await seek(page, 1200);
	await expect(caption.locator('[data-caption-word-state="active"]')).toHaveText("word");
	for (const [time, word] of [
		[400, "Follow"],
		[499, "Follow"],
		[500, "every"],
		[900, "every"],
		[999, "every"],
		[1000, "word"],
		[1499, "word"],
	] as const) {
		await seek(page, time);
		await expect(caption.locator('[data-caption-word-state="active"]')).toHaveText(word);
		await expect(highlight).toHaveCount(1);
		const box = await caption.boundingBox();
		expect(box!.width).toBeCloseTo(initialBox!.width, 2);
		expect(box!.x).toBeCloseTo(initialBox!.x, 2);
	}

	await seek(page, 2500);
	await expect(caption).toHaveCount(0);
	await seek(page, 3100);
	await expect(caption).toHaveText("Clean caption transitions");
	await expect(highlight).toHaveCount(0);
	await seek(page, 3500);
	await expect(caption.locator('[data-caption-word-state="active"]')).toHaveText("Clean");
	await expect(highlight).toHaveCount(1);
	await seek(page, 3750);
	await expect(highlight).toHaveCount(1);
	await expect(caption.locator('[data-caption-word-state="active"]')).toHaveText("Clean");
	await seek(page, 3800);
	await expect(caption.locator('[data-caption-word-state="active"]')).toHaveText("caption");
	await expect(caption).toHaveText("Clean caption transitions");
	expect(errors).toEqual([]);
});

test("legacy and modern export highlight the active word and round the black background", async ({
	page,
}) => {
	await page.goto("/tests/ui/caption-rendering.html");
	await expect(page.locator("body")).toHaveAttribute("data-result", /samples/);
	const result = JSON.parse((await page.locator("body").getAttribute("data-result"))!);
	for (const sample of result.samples) {
		expect(sample.heldMatchesActive).toBe(true);
		expect(sample.activePixelsDiffer).toBe(true);
		expect(sample.cornerAlpha).toBe(0);
		expect(sample.pause[3]).toBeGreaterThanOrEqual(178);
		expect(sample.pause[3]).toBeLessThanOrEqual(179);
		expect(
			sample.backgroundBounds.every(
				(bounds: number[]) =>
					JSON.stringify(bounds) === JSON.stringify(sample.backgroundBounds[0]),
			),
		).toBe(true);
		expect(sample.silence[3]).toBe(0);
	}
	expect(result.nextText).toBe("Next phrase");
	expect(result.nextActiveWord).toBe(-1);
});

test("caption styles keep the box compact and steady while previewing each preset", async ({
	page,
}, testInfo) => {
	await page.goto("/tests/ui/caption-preview.html");
	const picker = page.getByRole("group", { name: "Caption style", exact: true });
	await expect(picker.getByRole("button")).toHaveCount(6);
	const caption = page.getByRole("button", { name: "Edit current caption", exact: true });
	for (const [name, weight, color, hasPill] of [
		["Classic", "400", "rgb(255, 255, 255)", true],
		["TikTok", "800", "rgb(255, 230, 0)", false],
		["Karaoke", "700", "rgb(20, 32, 0)", true],
		["Minimal", "500", "rgb(255, 255, 255)", false],
		["Neon", "700", "rgb(101, 255, 255)", true],
		["Paper", "600", "rgb(31, 41, 55)", true],
	] as const) {
		const option = picker.getByRole("button", { name, exact: true });
		await option.click();
		await expect(option).toHaveAttribute("aria-pressed", "true");
		await seek(page, 700);
		await expect(caption).toHaveCSS("font-weight", weight);
		if (name === "TikTok") {
			await expect(caption).toHaveCSS("font-family", /TikTok Sans/);
			expect(
				await page.evaluate(() =>
					Array.from(document.fonts).some(
						(face) =>
							face.family.replaceAll('"', "") === "TikTok Sans" &&
							face.status === "loaded",
					),
				),
			).toBe(true);
		}
		const active = caption.locator('[data-caption-word-state="active"]');
		await expect(active).toHaveCSS("color", color);
		await expect(active.locator('[aria-hidden="true"]')).toHaveCount(hasPill ? 1 : 0);
		const size = await caption.evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
		const box = await caption.boundingBox();
		expect(box!.height / size).toBeCloseTo(2.12, 1);
		for (const time of [400, 700, 1200]) {
			await seek(page, time);
			const next = await caption.boundingBox();
			expect(next!.width).toBeCloseTo(box!.width, 2);
			expect(next!.height).toBeCloseTo(box!.height, 2);
		}
		await seek(page, 700);
		await page.screenshot({ path: testInfo.outputPath(`caption-${name.toLowerCase()}.png`) });
	}
	await picker.getByRole("button", { name: "Classic", exact: true }).click();
	await expect(caption).toHaveCSS("background-color", "rgba(0, 0, 0, 0.7)");
});

test("all caption styles render their foreground and background in both export paths", async ({
	page,
}) => {
	await page.goto("/tests/ui/caption-rendering.html");
	await expect(page.locator("body")).toHaveAttribute("data-result", /styles/);
	const result = JSON.parse((await page.locator("body").getAttribute("data-result"))!);
	expect(result.styles).toHaveLength(6);
	for (const style of result.styles) {
		expect(new Set(style.widths).size, style.id).toBe(1);
		expect(style.heightInEm, style.id).toBeCloseTo(2.12, 2);
		for (const sample of style.samples) {
			expect(sample.foregroundPixels, style.id).toBeGreaterThan(5);
			expect(
				Math.abs(sample.backgroundAlpha - style.backgroundOpacity * 255),
				style.id,
			).toBeLessThanOrEqual(1);
			if (style.id === "paper") {
				expect(sample.backgroundPixel.slice(0, 3)).toEqual([255, 251, 235]);
			}
		}
	}
});

test("six style cards fill equal columns and keep previews inset at narrow widths", async ({
	page,
}, testInfo) => {
	await page.goto("/tests/ui/caption-preview.html");
	const picker = page.getByRole("group", { name: "Caption style", exact: true });
	for (const width of [280, 240, 200]) {
		await page.locator("aside").evaluate((node, width) => {
			node.style.width = `${width}px`;
			node.style.flexShrink = "0";
		}, width);
		const geometry = await picker.evaluate((group) => {
			const grid = group.getBoundingClientRect();
			return Array.from(group.querySelectorAll("button")).map((button) => {
				const card = button.getBoundingClientRect();
				const preview = button
					.querySelector('[aria-hidden="true"]')!
					.getBoundingClientRect();
				const sample = button
					.querySelector('[aria-hidden="true"] > span')!
					.getBoundingClientRect();
				return {
					width: card.width,
					height: card.height,
					expectedWidth: (grid.width - 8) / 2,
					leftInset: sample.left - preview.left,
					rightInset: preview.right - sample.right,
				};
			});
		});
		for (const card of geometry) {
			expect(card.width).toBeCloseTo(card.expectedWidth, 1);
			expect(card.height).toBe(84);
			expect(card.leftInset).toBeGreaterThanOrEqual(6);
			expect(card.rightInset).toBeGreaterThanOrEqual(6);
		}
	}
	await page.locator("aside").evaluate((node) => {
		node.style.width = "280px";
	});
	await picker.screenshot({ path: testInfo.outputPath("six-caption-styles.png") });
});
