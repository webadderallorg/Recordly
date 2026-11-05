import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("Home stays opaque throughout its loading transition over the editor", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		const save = window.electronAPI.saveProjectFile;
		window.electronAPI.saveProjectFile = async (...args) => {
			if (args[3])
				await new Promise<void>((resolve) => {
					window.addEventListener("test-release-home-save", () => resolve(), {
						once: true,
					});
				});
			return save(...args);
		};
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator(".editor-inspector")).toBeVisible({ timeout: 30000 });
	await expect(page.locator("html")).toHaveAttribute("data-project-creates", "1");
	await page.evaluate(() => {
		const samples: number[] = [];
		Object.assign(window, { homeOpacitySamples: samples });
		const sample = () => {
			const home = document.querySelector(".dashboard-shell");
			if (home) {
				const backdrop = home.closest(".modal__backdrop")!;
				const container = home.closest(".modal__container")!;
				samples.push(
					Number(getComputedStyle(backdrop).opacity) *
						Number(getComputedStyle(container).opacity),
				);
			}
			if (!(window as unknown as { homeSamplingDone?: boolean }).homeSamplingDone)
				requestAnimationFrame(sample);
		};
		requestAnimationFrame(sample);
	});
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const home = page.getByRole("dialog", { name: "Projects dashboard" });
	await expect(home.getByLabel("Loading projects")).toBeVisible();
	const samples = await page.evaluate(async () => {
		const start = performance.now();
		const state = window as unknown as {
			homeOpacitySamples: number[];
			homeSamplingDone: boolean;
		};
		while (performance.now() - start < 350 || state.homeOpacitySamples.length < 3)
			await new Promise(requestAnimationFrame);
		state.homeSamplingDone = true;
		return state.homeOpacitySamples;
	});
	expect(samples.length).toBeGreaterThan(2);
	expect(Math.min(...samples), "Home must never fade through to the editor").toBe(1);
	await page.evaluate(() => window.dispatchEvent(new Event("test-release-home-save")));
	await expect(home.getByLabel("Loading projects")).toHaveCount(0);
	await home.getByRole("button", { name: "Resume Untitled Project", exact: true }).click();
	await expect(home).not.toBeVisible();
	await expect(page.locator(".editor-inspector")).toBeVisible();
});
