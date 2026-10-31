import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("editor mode never opens the camera and releases an active recorder preview", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		let visible: ((value: boolean) => void) | undefined;
		window.electronAPI.getRecordingPreferences = async () => ({
			success: true,
			webcamEnabled: true,
			microphoneEnabled: false,
			systemAudioEnabled: false,
		});
		window.electronAPI.getEditorMode = async () => true;
		window.electronAPI.onEditorModeChanged = (callback) => {
			visible = callback;
			return () => {
				visible = undefined;
			};
		};
		window.addEventListener("test-leave-editor", () => visible?.(false));
		window.addEventListener("test-enter-editor", () => visible?.(true));
		let requests = 0;
		Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
			value: async () => {
				document.documentElement.dataset.cameraRequests = String(++requests);
				const canvas = document.createElement("canvas");
				const stream = canvas.captureStream();
				for (const track of stream.getTracks()) {
					const stop = track.stop.bind(track);
					track.stop = () => {
						document.documentElement.dataset.cameraStopped = "true";
						stop();
					};
				}
				return stream;
			},
		});
	});
	await page.goto("/?windowType=hud-overlay");
	await expect(page.getByRole("button", { name: "Disable webcam" })).toBeVisible();
	expect(await page.locator("html").getAttribute("data-camera-requests")).toBeNull();
	await page.evaluate(() => window.dispatchEvent(new Event("test-leave-editor")));
	await expect(page.locator("html")).toHaveAttribute("data-camera-requests", "1");
	await page.evaluate(() => window.dispatchEvent(new Event("test-enter-editor")));
	await expect(page.locator("html")).toHaveAttribute("data-camera-stopped", "true");
	await page.evaluate(() => navigator.mediaDevices.dispatchEvent(new Event("devicechange")));
	await expect(page.locator("html")).toHaveAttribute("data-camera-requests", "1");
});
