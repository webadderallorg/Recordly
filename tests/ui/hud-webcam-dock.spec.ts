import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("webcam and HUD stay docked across recording states and drag together within the screen", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		window.electronAPI.getEditorMode = async () => false;
		window.electronAPI.getRecordingPreferences = async () => ({
			success: true,
			microphoneEnabled: false,
			webcamEnabled: true,
			systemAudioEnabled: false,
		});
		window.electronAPI.onRecordingStateChanged = (callback) => {
			const listener = () => callback({ recording: true, sourceName: "Built-in Display" });
			window.addEventListener("test-recording-started", listener);
			return () => window.removeEventListener("test-recording-started", listener);
		};
		window.electronAPI.hudOverlayHide = async () => {
			document.documentElement.dataset.hudHidden = "true";
			return { success: true };
		};
		navigator.mediaDevices.getUserMedia = async () => {
			const canvas = document.createElement("canvas");
			canvas.width = 320;
			canvas.height = 320;
			const context = canvas.getContext("2d")!;
			context.fillStyle = "#d1d5db";
			context.fillRect(0, 0, 320, 320);
			return canvas.captureStream(24);
		};
		navigator.mediaDevices.enumerateDevices = async () => [];
	});
	await page.goto("/?windowType=hud-overlay");
	const preview = page.locator("[data-floating-webcam-preview]");
	const bar = page.locator("[data-recording-state]");
	await expect(preview).toBeVisible();
	const readyBar = (await bar.boundingBox())!;
	const readyCamera = (await preview.boundingBox())!;
	expect(readyBar.x - readyCamera.x - readyCamera.width).toBeCloseTo(10);
	expect(readyCamera.y + readyCamera.height).toBeCloseTo(readyBar.y + readyBar.height);
	await page.evaluate(() => window.dispatchEvent(new Event("test-recording-started")));
	await expect(page.getByRole("group", { name: "Recording controls" })).toBeVisible();
	await expect
		.poll(() =>
			bar.evaluate(
				(node) =>
					node
						.getAnimations({ subtree: true })
						.filter((animation) => animation.playState === "running").length,
			),
		)
		.toBe(0);
	const recordingCamera = (await preview.boundingBox())!;
	const captureBounds = (await bar.boundingBox())!;
	expect(captureBounds.x + captureBounds.width / 2).toBeCloseTo(720);
	expect(readyBar.x + readyBar.width / 2).toBeCloseTo(720);
	const recordingBar = (await bar.boundingBox())!;
	await page.mouse.move(
		recordingCamera.x + recordingCamera.width / 2,
		recordingCamera.y + recordingCamera.height / 2,
	);
	await page.mouse.down();
	await page.mouse.move(
		recordingCamera.x + recordingCamera.width / 2 + 100,
		recordingCamera.y + recordingCamera.height / 2 - 100,
		{ steps: 8 },
	);
	await page.mouse.up();
	const movedBar = (await bar.boundingBox())!;
	const movedCamera = (await preview.boundingBox())!;
	expect(movedCamera.x).toBeCloseTo(recordingCamera.x + 100);
	expect(movedBar.x).toBeCloseTo(recordingBar.x + 100);
	expect(movedBar.y).toBeCloseTo(recordingBar.y - 100);
	await page.screenshot({
		path: "test-results/hud-webcam-dock.png",
		clip: {
			x: movedCamera.x - 12,
			y: movedCamera.y - 12,
			width: movedBar.x + movedBar.width - movedCamera.x + 24,
			height: movedCamera.height + 24,
		},
	});
	await page.mouse.move(movedCamera.x + 50, movedCamera.y + 50);
	await page.mouse.down();
	await page.mouse.move(0, 0, { steps: 8 });
	await page.mouse.up();
	expect((await bar.boundingBox())!.x).toBeGreaterThanOrEqual(0);
	expect((await preview.boundingBox())!.y).toBeGreaterThanOrEqual(0);
	await page.getByRole("button", { name: /Hide/ }).click();
	await expect(page.locator("html")).toHaveAttribute("data-hud-hidden", "true");
	await page.setViewportSize({ width: 600, height: 700 });
	await expect
		.poll(async () => {
			const camera = (await preview.boundingBox())!;
			const controls = (await bar.boundingBox())!;
			return Math.round(controls.y - camera.y - camera.height);
		})
		.toBe(10);
	await expect.poll(async () => (await bar.boundingBox())!.x).toBeGreaterThanOrEqual(0);
	const narrowBar = (await bar.boundingBox())!;
	expect(narrowBar.x).toBeGreaterThanOrEqual(0);
	expect(narrowBar.x + narrowBar.width).toBeLessThanOrEqual(600);
	expect(narrowBar.y + narrowBar.height).toBeLessThanOrEqual(700);
});
