import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function installAutoZoomBridge(page: Page) {
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getCursorTelemetry = async () => ({
			success: true,
			samples: [
				{ timeMs: 0, cx: 0.2, cy: 0.5, interactionType: "move" },
				{ timeMs: 6000, cx: 0.8, cy: 0.5, interactionType: "move" },
			],
		});
	});
}

test("auto zoom nudge repeats until a project edit, and stays dismissed after undo", async ({
	page,
}) => {
	test.setTimeout(90000);
	await installAutoZoomBridge(page);
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
	await installAutoZoomBridge(page);
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
	await installAutoZoomBridge(page);
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

test("auto zoom nudge starts again for each new project after dismissing the previous one", async ({
	page,
}) => {
	test.setTimeout(90_000);
	await installAutoZoomBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getCurrentVideoPath = async () => ({
			success: true,
			path: `${location.origin}/tests/ui/fixtures/filmstrip.mp4?project=${new URLSearchParams(location.search).get("project")}`,
		});
	});
	const apply = page.getByRole("button", { name: "Apply auto zooms", exact: true });
	const nudge = apply.locator("..");
	for (const project of ["first", "second", "third"]) {
		await page.goto(`/?windowType=editor&project=${project}`);
		await expect(nudge).toHaveCSS("animation-duration", "3s", { timeout: 20_000 });
		await expect(nudge).toHaveCSS("animation-iteration-count", "infinite");
		await expect(page.locator('[data-variant="zoom"]')).toHaveCount(0);
		await page.getByRole("slider", { name: "Padding", exact: true }).press("ArrowRight");
		await expect(nudge).toHaveCSS("animation-name", "none");
	}
});

test("importing new projects through Home restarts the nudge without reloading the editor", async ({
	page,
}) => {
	test.setTimeout(90_000);
	await installAutoZoomBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		let imported = 0;
		window.electronAPI.openVideoFilePicker = async () => ({
			success: true,
			path: `${location.origin}/tests/ui/fixtures/filmstrip.mp4?import=${++imported}`,
		});
	});
	await page.goto("/?windowType=editor");
	const nudge = page.getByRole("button", { name: "Apply auto zooms", exact: true }).locator("..");
	for (let index = 0; index < 3; index++) {
		await expect(nudge).toHaveCSS("animation-duration", "3s", { timeout: 20_000 });
		await page.getByRole("slider", { name: "Padding", exact: true }).press("ArrowRight");
		await expect(nudge).toHaveCSS("animation-name", "none");
		if (index === 2) break;
		await page.getByRole("button", { name: "Home", exact: true }).click();
		const home = page.getByRole("dialog", { name: "Projects dashboard" });
		await home.getByRole("button", { name: "Import", exact: true }).click();
		await expect(home).toBeHidden();
		await expect(page.locator('[data-variant="clip"]')).toHaveCount(1);
	}
});
