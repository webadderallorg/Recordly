import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("recording setup exposes controls and supports keyboard source selection", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=hud-overlay");

	const setup = page.getByRole("group", { name: "Recording setup" });
	await expect(setup.getByRole("button", { name: "Source: Built-in Display" })).toBeVisible();
	await expect(setup.getByRole("button", { name: "Microphone: off" })).toBeVisible();
	await expect(setup.getByRole("button", { name: "Webcam: off" })).toBeVisible();
	await expect(setup.getByRole("button", { name: "Countdown delay: 3s" })).toBeVisible();
	await expect(setup.getByRole("button", { name: "Record", exact: true })).toBeVisible();

	const sourceTrigger = setup.getByRole("button", { name: "Source: Built-in Display" });
	await sourceTrigger.focus();
	await page.keyboard.press("Enter");
	const source = page.getByRole("button", { name: "Screen: Built-in Display" });
	await expect(source).toBeVisible();
	await source.focus();
	await page.keyboard.press("Space");
	await expect(source).toHaveCount(0);
});

test("source picker announces loading and empty results", async ({ page }) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=hud-overlay");
	await page.evaluate(() => {
		window.electronAPI.getSources = () =>
			new Promise((resolve) => {
				window.addEventListener("test-resolve-sources", () => resolve([]), { once: true });
			});
	});

	const sourceTrigger = page.getByRole("button", { name: "Source: Built-in Display" });
	await sourceTrigger.focus();
	await page.keyboard.press("Enter");
	await expect(page.getByRole("status").filter({ hasText: "Loading sources..." })).toBeVisible();
	await page.evaluate(() => window.dispatchEvent(new Event("test-resolve-sources")));
	await expect(page.getByRole("status").filter({ hasText: "No sources found" })).toBeVisible();
});

test("recording state is announced separately from the running timer", async ({ page }) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		window.electronAPI.onRecordingStateChanged = (callback) => {
			const listener = () => callback({ recording: true, sourceName: "Built-in Display" });
			window.addEventListener("test-recording-started", listener);
			return () => window.removeEventListener("test-recording-started", listener);
		};
	});
	await page.goto("/?windowType=hud-overlay");
	await expect(page.getByRole("group", { name: "Recording setup" })).toBeVisible();
	await page.evaluate(() => window.dispatchEvent(new Event("test-recording-started")));

	const controls = page.getByRole("group", { name: "Recording controls" });
	await expect(controls).toBeVisible();
	await expect(page.getByRole("status")).toHaveText("Recording in progress");
	await expect(controls.getByRole("timer")).toHaveAttribute("aria-live", "off");
	await expect(controls.getByRole("button", { name: "Pause" })).toBeVisible();
	await expect(controls.getByRole("button", { name: "Stop" })).toBeVisible();
});
