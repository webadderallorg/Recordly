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
	await expect(page.getByRole("button", { name: "Camera", exact: true })).toBeVisible();
	expect(await page.locator("html").getAttribute("data-camera-requests")).toBeNull();
	await page.evaluate(() => window.dispatchEvent(new Event("test-leave-editor")));
	await expect(page.locator("html")).toHaveAttribute("data-camera-requests", "1");
	// The floating HUD preview is circular; editor mode still controls camera ownership.
	await expect(page.locator("[data-floating-webcam-preview] video")).toHaveCSS(
		"clip-path",
		/^circle\(50%(?: at 50% 50%)?\)$/,
	);
	await page.evaluate(() => window.dispatchEvent(new Event("test-enter-editor")));
	await expect(page.locator("html")).toHaveAttribute("data-camera-stopped", "true");
	await page.evaluate(() => navigator.mediaDevices.dispatchEvent(new Event("devicechange")));
	await expect(page.locator("html")).toHaveAttribute("data-camera-requests", "1");
});

test("camera options preview preserves saved squircle rounding", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		const getAppSetting = window.electronAPI.getAppSetting;
		window.electronAPI.getAppSetting = (key) =>
			key === "recordly.editor.preferences"
				? { webcam: { shape: "squircle", roundness: 69 } }
				: getAppSetting(key);
		window.electronAPI.getRecordingPreferences = async () => ({
			success: true,
			webcamEnabled: true,
			microphoneEnabled: false,
			systemAudioEnabled: false,
		});
		window.electronAPI.getEditorMode = async () => false;
		Object.defineProperty(navigator.mediaDevices, "enumerateDevices", {
			value: async () => [],
		});
		Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
			value: async () => {
				document.documentElement.dataset.shapeCameraRequests = String(
					Number(document.documentElement.dataset.shapeCameraRequests ?? 0) + 1,
				);
				const canvas = document.createElement("canvas");
				canvas.width = 96;
				canvas.height = 96;
				const context = canvas.getContext("2d")!;
				const stream = canvas.captureStream(24);
				const paint = () => {
					context.fillStyle = "#2874ff";
					context.fillRect(0, 0, 96, 96);
				};
				paint();
				const timer = setInterval(paint, 100);
				for (const track of stream.getTracks()) {
					const stop = track.stop.bind(track);
					track.stop = () => {
						clearInterval(timer);
						document.documentElement.dataset.shapeCameraStopped = "true";
						stop();
					};
				}
				return stream;
			},
		});
		// Platforms without mouse passthrough show the shaped preview inside camera options.
		window.electronAPI.getHudOverlayMousePassthroughSupported = async () => ({
			success: true,
			supported: false,
		});
	});
	await page.goto("/?windowType=hud-overlay");
	expect(await page.locator("html").getAttribute("data-shape-camera-requests")).toBeNull();
	await page.getByRole("button", { name: "Camera", exact: true }).click();
	await expect(page.locator("[data-floating-webcam-preview]")).toHaveCount(0);
	const camera = page.getByRole("dialog", { name: "Options", exact: true }).locator("video");
	await expect(camera).toBeVisible();
	await expect(page.locator("html")).toHaveAttribute("data-shape-camera-requests", "1");
	await expect
		.poll(() =>
			camera.evaluate(
				(video: HTMLVideoElement) =>
					video.srcObject instanceof MediaStream && video.videoWidth === 96,
			),
		)
		.toBe(true);
	await expect
		.poll(() =>
			camera.evaluate((node) => {
				const mask = node.parentElement!;
				const radius = Number(getComputedStyle(mask).clipPath.match(/M\s+([\d.]+)/)?.[1]);
				const box = mask.getBoundingClientRect();
				return Math.round(100 * (radius / (Math.min(box.width, box.height) / 2)) ** 4);
			}),
		)
		.toBe(69);
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog", { name: "Options", exact: true })).toHaveCount(0);
	await expect(page.locator("html")).toHaveAttribute("data-shape-camera-stopped", "true");
});
