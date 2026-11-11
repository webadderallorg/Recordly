import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("Recordly uses squircle corners for surfaces and respects explicit round controls", async ({
	page,
}) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
	await page.goto("/?windowType=onboarding&onboardingPreview=1");
	const popup = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await expect(popup).toBeVisible();
	const artwork = popup.locator("[data-onboarding-artwork]");
	await expect(artwork).toHaveCSS("corner-top-left-shape", /^(squircle|superellipse\(2\))$/);
	await expect(artwork).toHaveCSS("border-bottom-left-radius", "0px");
	await expect(popup.getByRole("button", { name: "Close onboarding window" })).toHaveCSS(
		"corner-top-left-shape",
		/^(round|superellipse\(1\))$/,
	);

	const comparison = await page.evaluate(() => {
		const tile = document.createElement("div");
		tile.className = "rounded-4xl";
		tile.style.cssText =
			"position:fixed;top:0;left:0;width:160px;height:160px;background:red;z-index:99999";
		document.querySelector('[data-onboarding-state="login"]')?.append(tile);
		const { left, top } = tile.getBoundingClientRect();
		const measure = () => {
			for (let offset = 0; offset < 20; offset += 0.25) {
				if (document.elementFromPoint(left + offset, top + offset) === tile) return offset;
			}
			throw new Error("Corner probe never intersects the surface");
		};
		const compensatedRadius = parseFloat(getComputedStyle(tile).borderTopLeftRadius);
		const squircleCutout = measure();
		tile.style.setProperty("--recordly-corner-radius-scale", "1");
		tile.style.setProperty("corner-shape", "round");
		const originalRadius = parseFloat(getComputedStyle(tile).borderTopLeftRadius);
		const roundCutout = measure();
		tile.remove();
		return { compensatedRadius, originalRadius, squircleCutout, roundCutout };
	});
	expect(comparison.originalRadius).toBe(32);
	expect(comparison.compensatedRadius).toBeCloseTo(32 * 1.84, 1);
	expect(Math.abs(comparison.squircleCutout - comparison.roundCutout)).toBeLessThanOrEqual(0.5);

	expect(
		await page.evaluate(() => {
			const tile = document.createElement("div");
			const contents = document.createElement("div");
			tile.style.cssText =
				"position:fixed;inset:0 auto auto 0;width:80px;height:80px;overflow:hidden;z-index:99999;pointer-events:auto";
			contents.style.cssText = "width:100%;height:100%;background:red";
			tile.append(contents);
			// Place the probe within the active dialog so its hit testing isn't inert.
			document.querySelector('[data-onboarding-state="login"]')?.append(tile);
			const containsCorner = () => document.elementFromPoint(8, 8) === contents;
			tile.style.borderRadius = "32px";
			const squircle = containsCorner();
			tile.style.setProperty("corner-shape", "round");
			const circle = containsCorner();
			tile.style.borderRadius = "0";
			const zero = containsCorner();
			tile.remove();
			return { squircle, circle, zero };
		}),
	).toEqual({ squircle: true, circle: false, zero: true });
	await page.screenshot({ path: test.info().outputPath("onboarding.png") });
});

test("toolbar hover stays squircle and the slider thumb stays round", async ({ page }) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	const addLayer = page.getByRole("button", { name: "Add Layer", exact: true });
	await addLayer.hover();
	await expect(addLayer).toHaveCSS("corner-top-left-shape", /^(squircle|superellipse\(2\))$/);

	const padding = page.getByRole("slider", { name: "Padding", exact: true });
	const thumb = padding.locator(
		'xpath=ancestor::*[contains(concat(" ", @class, " "), " slider__thumb ")]',
	);
	await expect(thumb).toBeVisible();
	const pill = await thumb.evaluate((element) => {
		const style = getComputedStyle(element, "::after");
		return {
			shape: style.getPropertyValue("corner-top-left-shape"),
			radius: style.borderTopLeftRadius,
			height: style.height,
		};
	});
	expect(pill.shape).toMatch(/^(round|superellipse\(1\))$/);
	expect(parseFloat(pill.radius)).toBeCloseTo(parseFloat(pill.height) / 2);
});

test("compact Settings clips its surface and keeps switch tracks round", async ({ page }) => {
	await page.setViewportSize({ width: 1000, height: 640 });
	await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	const settings = page.getByRole("dialog", { name: "Settings", exact: true });
	await expect(settings).toHaveCSS("corner-top-left-shape", /^(squircle|superellipse\(2\))$/);
	await expect(settings).not.toHaveCSS("border-top-left-radius", "0px");
	await expect(settings.locator(".switch__control:visible").first()).toHaveCSS(
		"corner-top-left-shape",
		/^(round|superellipse\(1\))$/,
	);
	await settings.screenshot({ path: test.info().outputPath("compact-settings.png") });
});
