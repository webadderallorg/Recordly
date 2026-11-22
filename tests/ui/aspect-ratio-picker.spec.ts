import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test.setTimeout(90000);

test("source ratio grid and platform presets change the canvas and persist without closing the panel", async ({
	page,
}) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
		const save = window.electronAPI.saveProjectFile;
		window.electronAPI.saveProjectFile = async (...args) => {
			document.documentElement.dataset.ratioProject = JSON.stringify(args[0]);
			return save(...args);
		};
	});
	await page.goto("/?windowType=editor");
	const trigger = page.getByRole("button", { name: /^Aspect ratio:/ });
	await trigger.click();
	const card = page.getByRole("dialog", { name: "Aspect ratio", exact: true });
	await expect(card.getByRole("spinbutton", { name: "Width", exact: true })).toBeVisible();
	const standard = card.locator('section[aria-label="Standard ratios"]');
	await expect(standard.getByRole("radio")).toHaveCount(9);
	await expect(card.locator(".aspect-ratio-picker__heading")).toHaveText([
		"Twitter",
		"YouTube",
		"Instagram",
	]);
	await expect(
		card.locator(
			'section[aria-label="Appstore"], section[aria-label="Pinterest"], section[aria-label="Dribbble"]',
		),
	).toHaveCount(0);
	const native = card.locator('section[aria-label="Recordly"]');
	await expect(native.getByRole("radio", { name: "Auto", exact: true })).toBeChecked();
	const nativeBox = await native.boundingBox();
	const sizeBox = await card.locator("form").boundingBox();
	const standardBox = await standard.boundingBox();
	expect(sizeBox!.y + sizeBox!.height).toBeLessThan(nativeBox!.y);
	expect(nativeBox!.y + nativeBox!.height).toBeLessThan(standardBox!.y);

	const shapes = await standard.locator(".aspect-ratio-picker__shape").evaluateAll((elements) =>
		elements.map((el) => {
			const rect = el.getBoundingClientRect();
			return {
				width: rect.width,
				height: rect.height,
				ratio: Number(getComputedStyle(el).aspectRatio.split("/")[0]),
			};
		}),
	);
	for (const shape of shapes) expect(shape.width / shape.height).toBeCloseTo(shape.ratio, 2);
	await page.screenshot({
		path: "test-results/aspect-ratio-source-card.png",
		animations: "disabled",
	});
	for (const [section, name, ratio] of [
		["Standard ratios", "3:2", "3:2"],
		["Instagram", "Story 9:16", "9:16"],
		["Twitter", "Cover 3:1", "3:1"],
		["YouTube", "Video 16:9", "16:9"],
		["Recordly", "16:10", "16:10"],
		["Recordly", "10:16", "10:16"],
		["Recordly", "Auto", "native"],
	]) {
		const option = card
			.locator(`section[aria-label="${section}"]`)
			.getByRole("radio", { name, exact: true });
		await card
			.locator(".aspect-ratio-picker__option")
			.filter({ has: page.getByRole("radio", { name, exact: true }) })
			.locator('[data-slot="radio-content"]')
			.click();
		await expect(card).toBeVisible();
		await expect(option).toBeChecked();
		await expect(trigger).toHaveAccessibleName(
			`Aspect ratio: ${ratio === "native" ? "Auto" : ratio}`,
		);
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						JSON.parse(document.documentElement.dataset.ratioProject ?? "{}").editor
							?.aspectRatio,
				),
			)
			.toBe(ratio);
		if (ratio !== "native") {
			const [w, h] = ratio.split(":").map(Number);
			await expect
				.poll(async () => {
					const box = await page.locator(".editor-preview-frame").boundingBox();
					return box ? box.width / box.height : 0;
				})
				.toBeCloseTo(w / h, 2);
		}
	}
	await page.keyboard.press("Escape");
	await expect(card).not.toBeVisible();
	await expect(trigger).toBeFocused();
});

test("source custom W/H form, keyboard selection and scrolling fit a shorter window", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1024, height: 700 });
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	const trigger = page.getByRole("button", { name: /^Aspect ratio:/ });
	await trigger.press("Enter");
	const card = page.getByRole("dialog", { name: "Aspect ratio", exact: true });
	await expect(card).toBeVisible();
	await expect(page.locator(".aspect-ratio-picker")).not.toHaveAttribute("data-entering");
	const bounds = await page.locator(".aspect-ratio-picker").boundingBox();
	expect(bounds!.width).toBe(320);
	expect(bounds!.y).toBeGreaterThanOrEqual(0);
	expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(700);
	await expect(card.getByRole("button", { name: "Set", exact: true })).toHaveCount(0);
	const width = card.getByRole("spinbutton", { name: "Width", exact: true });
	const height = card.getByRole("spinbutton", { name: "Height", exact: true });
	await expect(width).not.toHaveValue("");
	await expect(height).not.toHaveValue("");
	await width.fill("0");
	await height.fill("800");
	await expect(trigger).toHaveAccessibleName("Aspect ratio: Auto");
	await width.fill("1200");
	await expect(trigger).toHaveAccessibleName("Aspect ratio: 1200:800");
	await expect(width).toBeFocused();
	await height.fill("600");
	await expect(trigger).toHaveAccessibleName("Aspect ratio: 1200:600");
	await expect(height).toBeFocused();
	for (const invalid of ["", "127", "7681", "1.5"]) {
		await height.fill(invalid);
		await expect(trigger).toHaveAccessibleName("Aspect ratio: 1200:600");
	}
	await height.fill("800");
	await expect(trigger).toHaveAccessibleName("Aspect ratio: 1200:800");
	await expect(card).toBeVisible();
	await page.keyboard.press("Escape");
	await trigger.click();
	await expect(width).toHaveValue("1200");
	await expect(height).toHaveValue("800");
	const standard = card.locator('section[aria-label="Standard ratios"]');
	await standard
		.locator(".aspect-ratio-picker__option")
		.filter({ has: page.getByRole("radio", { name: "16:9", exact: true }) })
		.locator('[data-slot="radio-content"]')
		.click();
	await page.keyboard.press("ArrowRight");
	await expect(standard.getByRole("radio", { name: "3:2", exact: true })).toBeChecked();
	await card
		.locator('section[aria-label="Instagram"]')
		.locator(".aspect-ratio-picker__option")
		.filter({ hasText: "Story" })
		.locator('[data-slot="radio-content"]')
		.click();
	await page.screenshot({
		path: "test-results/aspect-ratio-source-social.png",
		animations: "disabled",
	});
	await page.keyboard.press("Escape");
	await expect(card).not.toBeVisible();
	await expect(trigger).toBeFocused();
});
