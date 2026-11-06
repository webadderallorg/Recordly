import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("auto zoom nudge repeats until a project edit, and stays dismissed after undo", async ({
	page,
}) => {
	test.setTimeout(90000);
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	const apply = page.getByRole("button", { name: "Apply auto zooms", exact: true });
	const nudge = apply.locator("..");
	await expect(apply).toBeVisible({ timeout: 20000 });
	await expect(nudge).toHaveCSS("animation-duration", "3s");
	await expect(nudge).toHaveCSS("animation-delay", "0s");
	await expect(nudge).toHaveCSS("animation-iteration-count", "infinite");
	const transforms = await nudge.evaluate((button) => {
		const animation = button.getAnimations()[0];
		animation.pause();
		animation.currentTime = 90;
		const shaking = getComputedStyle(button).transform;
		animation.currentTime = 600;
		const resting = getComputedStyle(button).transform;
		animation.currentTime = 3090;
		const repeated = getComputedStyle(button).transform;
		animation.play();
		return { shaking, resting, repeated };
	});
	expect(transforms.shaking).not.toBe(transforms.resting);
	expect(transforms.repeated).toBe(transforms.shaking);
	await page.emulateMedia({ reducedMotion: "reduce" });
	await expect(nudge).toHaveCSS("animation-name", "none");
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await expect(nudge).toHaveCSS("animation-duration", "3s");

	await page.locator('[data-timeline-row="row-zoom"]').click({ position: { x: 250, y: 20 } });
	await page.locator('[data-variant="clip"]').click();
	await expect(nudge).toHaveCSS("animation-duration", "3s");
	await page.getByRole("button", { name: /^Split Clip \(/ }).click();
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(2);
	await expect(nudge).toHaveCSS("animation-name", "none");
	await page.keyboard.press("Meta+z");
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(1);
	await expect(nudge).toHaveCSS("animation-name", "none");
	await expect(apply).toBeEnabled();
});

test("appearance edits also stop the auto zoom nudge", async ({ page }) => {
	test.setTimeout(90000);
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	const apply = page.getByRole("button", { name: "Apply auto zooms", exact: true });
	const nudge = apply.locator("..");
	await expect(nudge).toHaveCSS("animation-duration", "3s", { timeout: 20000 });
	const padding = page.getByRole("slider", { name: "Padding", exact: true });
	await padding.focus();
	await page.keyboard.press("ArrowRight");
	await expect(nudge).toHaveCSS("animation-name", "none");
});

test("auto zoom nudge keeps repeating without an edit", async ({ page }) => {
	test.setTimeout(90000);
	await page.clock.install();
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	const apply = page.getByRole("button", { name: "Apply auto zooms", exact: true });
	const nudge = apply.locator("..");
	await expect(nudge).toHaveCSS("animation-duration", "3s", { timeout: 20000 });
	await page.clock.fastForward(60000);
	await expect(nudge).toHaveCSS("animation-duration", "3s");
	await expect(nudge).toHaveCSS("animation-iteration-count", "infinite");
	await expect(apply).toBeEnabled();
	await page.locator('[data-timeline-row="row-zoom"]').click({ position: { x: 250, y: 20 } });
	await page.clock.fastForward(3000);
	await expect(nudge).toHaveCSS("animation-duration", "3s");
	await expect(page.locator('[data-variant="zoom"]')).toHaveCount(0);
});
