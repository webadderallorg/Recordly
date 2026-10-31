import { expect, test, type Page, type Locator } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

async function seek(page: Page, clip: Locator, timeMs: number) {
	const end = Number(await clip.getAttribute("data-end-ms"));
	const box = (await clip.locator(".timeline-block").boundingBox())!;
	const cap = (await page.getByTestId("playhead-cap").boundingBox())!;
	await page.mouse.move(cap.x + cap.width / 2, cap.y + cap.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + (box.width * timeMs) / end, cap.y + cap.height / 2);
	await page.mouse.up();
}

test("captions render in preview and remain synchronized at 1x, 2x and 4x", async ({ page }) => {
	test.setTimeout(60000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	const clip = page.locator('[data-variant="clip"]');
	await expect(clip).toHaveAttribute("data-end-ms", "6000", { timeout: 20000 });
	await expect(clip.locator("img").first()).toBeVisible({ timeout: 20000 });
	await expect(page.getByLabel("Loading preview")).toHaveCount(0);
	await page.getByRole("radio", { name: "Captions", exact: true }).click();
	const show = page.getByRole("switch", { name: "Show", exact: true });
	await page
		.locator('[data-slot="switch"]')
		.filter({ has: show })
		.locator('[data-slot="switch-control"]')
		.click();
	const strip = (await page.locator("[data-caption-add-target]").boundingBox())!;
	await page.mouse.click(strip.x + strip.width / 6, strip.y + 8);
	const caption = page.locator('[data-variant="caption"]');
	await expect(caption).toHaveCount(1);
	const text = page.getByRole("textbox", { name: "Text", exact: true });
	await text.fill("Caption speed check");
	await text.press("Enter");
	const sourceStart = Number(await caption.getAttribute("data-start-ms"));
	const sourceEnd = Number(await caption.getAttribute("data-end-ms"));
	const visibleCaption = page.getByRole("button", { name: "Edit current caption", exact: true });
	// Double-clicking a timeline caption immediately focuses its text editor.
	await caption.dblclick();
	await expect(text).toBeFocused();
	await text.fill("Caption speed check");
	await text.press("Enter");
	const selectionColors = await caption.locator(".timeline-block").evaluate((node) => {
		const probe = document.createElement("div");
		probe.style.borderColor = "var(--accent)";
		document.body.append(probe);
		const expected = getComputedStyle(probe).borderColor;
		probe.remove();
		return { actual: getComputedStyle(node).borderColor, expected };
	});
	expect(selectionColors.actual).toBe(selectionColors.expected);
	await seek(page, clip, (sourceStart + sourceEnd) / 2);
	await visibleCaption.dblclick();
	const inline = page.getByRole("textbox", { name: "Edit current caption", exact: true });
	await expect(inline).toBeFocused();
	await inline.fill("Direct caption edit");
	await inline.press("Tab");
	await expect(visibleCaption).toHaveText("Direct caption edit");
	await visibleCaption.dblclick();
	await inline.fill("Discard this draft");
	await inline.press("Escape");
	await expect(visibleCaption).toHaveText("Direct caption edit");
	await visibleCaption.dblclick();
	await inline.fill("Caption speed check");
	await inline.press("Tab");
	const video = page.locator('video[aria-hidden="true"]');
	for (const speed of [1, 2, 4]) {
		await clip.click({ position: { x: 80, y: 20 } });
		const control = page.getByRole("slider", { name: "Speed", exact: true });
		await control.focus();
		while (Number(await control.inputValue()) < speed) await control.press("ArrowRight");
		await expect(control).toHaveValue(String(speed));
		await expect(clip).toHaveAttribute("data-end-ms", String(6000 / speed));
		await expect
			.poll(async () => Number(await caption.getAttribute("data-start-ms")))
			.toBeCloseTo(sourceStart / speed, 0);
		await expect
			.poll(async () => Number(await caption.getAttribute("data-end-ms")))
			.toBeCloseTo(sourceEnd / speed, 0);
		await seek(page, clip, (sourceStart + sourceEnd) / 2 / speed);
		await expect(visibleCaption).toBeVisible();
		await expect(visibleCaption).toHaveText("Caption speed check");
		await expect
			.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime))
			.toBeCloseTo((sourceStart + sourceEnd) / 2000, 1);
		await expect
			.poll(() =>
				visibleCaption.evaluate((node) =>
					Number(getComputedStyle(node.parentElement!).opacity),
				),
			)
			.toBeGreaterThan(0.9);
		if (speed === 2) await page.screenshot({ path: "test-results/captions-at-2x.png" });
		await seek(page, clip, (sourceStart - 300) / speed);
		await expect(visibleCaption).toHaveCount(0);
		await seek(page, clip, (sourceEnd + 300) / speed);
		await expect(visibleCaption).toHaveCount(0);
	}
	// Exercise moving playback as well as paused seeks.
	await seek(page, clip, 0);
	await page.getByRole("button", { name: "Play", exact: true }).click();
	await expect(visibleCaption).toBeVisible();
	await expect
		.poll(() =>
			page
				.locator('video[aria-hidden="true"]')
				.evaluate((video: HTMLVideoElement) => video.currentTime * 1000),
		)
		.toBeGreaterThan(sourceEnd);
	await expect(visibleCaption).toHaveCount(0);
	expect(errors).toEqual([]);
});
