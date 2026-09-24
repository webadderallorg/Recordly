import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("HUD dividers are vertically centered", async ({ page }) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=hud-overlay");
	const dividers = page.locator(".separator--vertical");
	await expect(dividers.first()).toBeVisible();
	const offsets = await dividers.evaluateAll((elements) =>
		elements.map((element) => {
			const bounds = element.getBoundingClientRect();
			const parent = element.parentElement!.getBoundingClientRect();
			return Math.abs(bounds.y + bounds.height / 2 - parent.y - parent.height / 2);
		}),
	);
	for (const offset of offsets) expect(offset).toBeLessThanOrEqual(1);
	const home = page.getByRole("button", { name: "Home", exact: true });
	await expect(home.locator("svg")).toHaveAttribute("data-icon-style", "bold");
	await expect(page.getByRole("button", { name: "More", exact: true })).toHaveCount(0);
	const icon = await home.locator("svg").evaluate((element) => ({
		width: element.getBoundingClientRect().width,
		height: element.getBoundingClientRect().height,
	}));
	expect(icon).toEqual({ width: 20, height: 20 });
	await page.screenshot({ path: "test-results/hud-idle.png", animations: "disabled" });
	await home.click();
	await expect(page.locator("html")).toHaveAttribute("data-dashboard-opened", "true");
	await page.goto("/?windowType=editor");
	await expect(page.getByRole("dialog", { name: "Projects dashboard" })).toBeVisible();
});

test("recording HUD uses uniform controls and a readable timer", async ({ page }) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		window.electronAPI.onRecordingStateChanged = (callback) => {
			const listener = () => callback({ recording: true, sourceName: "Built-in Display" });
			window.addEventListener("test-recording-started", listener);
			return () => window.removeEventListener("test-recording-started", listener);
		};
	});
	await page.goto("/?windowType=hud-overlay");
	await expect(page.locator(".separator--vertical").first()).toBeVisible();
	await page.evaluate(() => window.dispatchEvent(new Event("test-recording-started")));
	const controls = page.getByRole("group", { name: "Recording controls" });
	await expect(controls).toBeVisible();
	await expect(controls.getByRole("timer")).toContainText("00:00");
	await expect(controls.getByRole("button", { name: "Home", exact: true })).toBeVisible();
	const sizes = await controls.getByRole("button").evaluateAll((buttons) =>
		buttons.map((button) => {
			return [(button as HTMLElement).offsetWidth, (button as HTMLElement).offsetHeight];
		}),
	);
	for (const size of sizes) expect(size).toEqual([36, 36]);
	await page.screenshot({ path: "test-results/hud-recording.png" });
});

test("New recording mode starts the webcam with an editor still open and releases it on Home", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		window.electronAPI.getEditorMode = async () => true;
		window.electronAPI.onEditorModeChanged = (callback) => {
			const listener = (event: Event) => callback((event as CustomEvent<boolean>).detail);
			window.addEventListener("test-editor-mode", listener);
			return () => window.removeEventListener("test-editor-mode", listener);
		};
		window.electronAPI.getRecordingPreferences = async () => ({
			success: true,
			microphoneEnabled: false,
			webcamEnabled: true,
			systemAudioEnabled: false,
		});
		navigator.mediaDevices.getUserMedia = async () => {
			const canvas = document.createElement("canvas");
			canvas.width = 320;
			canvas.height = 320;
			const context = canvas.getContext("2d")!;
			context.fillStyle = "#2874ff";
			context.fillRect(0, 0, 320, 320);
			const stream = canvas.captureStream(24);
			setInterval(() => context.fillRect(0, 0, 320, 320), 100);
			return stream;
		};
		navigator.mediaDevices.enumerateDevices = async () => [];
	});
	await page.goto("/?windowType=hud-overlay");
	const preview = page.locator("video").first();
	await expect(preview).toBeVisible();
	await expect
		.poll(() => preview.evaluate((video: HTMLVideoElement) => video.srcObject === null))
		.toBe(true);
	await page.evaluate(() =>
		window.dispatchEvent(new CustomEvent("test-editor-mode", { detail: false })),
	);
	await expect
		.poll(() =>
			preview.evaluate(
				(video: HTMLVideoElement) =>
					!!video.srcObject && !video.paused && video.videoWidth === 320,
			),
		)
		.toBe(true);
	await page.evaluate(() =>
		window.dispatchEvent(new CustomEvent("test-editor-mode", { detail: true })),
	);
	await expect
		.poll(() => preview.evaluate((video: HTMLVideoElement) => video.srcObject === null))
		.toBe(true);
});
