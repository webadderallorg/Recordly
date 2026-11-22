import { expect, test } from "@playwright/test";
import { getWebcamClipPath } from "../../src/components/video-editor/webcamOverlay";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("opening Camera settings requests access once instead of prompting from the HUD", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		let granted = false;
		window.electronAPI.getRecordingPreferences = async () => ({
			success: true,
			webcamEnabled: true,
			microphoneEnabled: false,
			systemAudioEnabled: false,
		});
		window.electronAPI.getEditorMode = async () => false;
		window.electronAPI.getMediaPermissionStatus = async () => {
			document.documentElement.dataset.cameraChecked = "true";
			return {
				success: true,
				microphone: "granted",
				camera: granted ? "granted" : "not-determined",
			};
		};
		window.electronAPI.requestMediaPermission = async (device) => {
			document.documentElement.dataset.cameraPermissionRequests = String(
				Number(document.documentElement.dataset.cameraPermissionRequests ?? 0) + 1,
			);
			await new Promise<void>((resolve) => {
				window.addEventListener("test-grant-camera", () => resolve(), { once: true });
			});
			granted = device === "camera";
			return { success: true, granted };
		};
		navigator.mediaDevices.getUserMedia = async () => {
			document.documentElement.dataset.cameraOpened = "true";
			return document.createElement("canvas").captureStream();
		};
	});
	await page.goto("/?windowType=hud-overlay");
	const html = page.locator("html");
	await expect(html).toHaveAttribute("data-camera-checked", "true");
	await expect(html).not.toHaveAttribute("data-camera-opened");
	await expect(html).not.toHaveAttribute("data-camera-permission-requests");
	const settings = page.getByRole("button", { name: "Camera settings", exact: true });
	await settings.click();
	await expect(html).toHaveAttribute("data-camera-permission-requests", "1");
	const dialog = page.getByRole("dialog", { name: "Camera settings", exact: true });
	await page.keyboard.press("Escape");
	await expect(dialog).not.toBeVisible();
	await settings.click();
	await expect(dialog).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(dialog).not.toBeVisible();
	await page.evaluate(() => window.dispatchEvent(new Event("test-grant-camera")));
	await expect(html).toHaveAttribute("data-camera-opened", "true");
	await expect(html).toHaveAttribute("data-camera-permission-requests", "1");
});

test("closing Camera settings cancels a pending fallback and reopening retries", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getRecordingPreferences = async () => ({
			success: true,
			webcamEnabled: false,
			webcamDeviceId: "unplugged-camera",
			microphoneEnabled: false,
			systemAudioEnabled: false,
		});
		window.electronAPI.getEditorMode = async () => false;
		window.electronAPI.getMediaPermissionStatus = async () => ({
			success: true,
			microphone: "granted",
			camera: "granted",
		});
		let fallbackOpened = false;
		const requests: string[] = [];
		navigator.mediaDevices.enumerateDevices = async () =>
			fallbackOpened
				? ([
						{
							kind: "videoinput",
							deviceId: "available-camera",
							label: "Replacement camera",
							groupId: "",
						},
					] as MediaDeviceInfo[])
				: [];
		navigator.mediaDevices.getUserMedia = async ({ video } = {}) => {
			const exact = video && typeof video === "object" && video.deviceId;
			requests.push(exact ? "preferred" : "default");
			document.documentElement.dataset.cameraRequests = requests.join(" ");
			if (exact) {
				await new Promise<void>((resolve) => {
					window.addEventListener("test-camera-missing", () => resolve(), { once: true });
				});
				throw new DOMException("Saved camera is disconnected", "OverconstrainedError");
			}
			fallbackOpened = true;
			return document.createElement("canvas").captureStream();
		};
	});
	await page.goto("/?windowType=hud-overlay");
	const html = page.locator("html");
	const settings = page.getByRole("button", { name: "Camera settings", exact: true });
	const dialog = page.getByRole("dialog", { name: "Camera settings", exact: true });
	await settings.click();
	await expect(html).toHaveAttribute("data-camera-requests", "preferred");
	await page.keyboard.press("Escape");
	await expect(dialog).not.toBeVisible();
	await settings.click();
	await expect(dialog).toBeVisible();
	await page.evaluate(() => window.dispatchEvent(new Event("test-camera-missing")));
	await expect(html).toHaveAttribute("data-camera-requests", "preferred preferred");
	await page.evaluate(() => {
		navigator.mediaDevices.dispatchEvent(new Event("devicechange"));
		window.dispatchEvent(new Event("test-camera-missing"));
	});
	await expect(html).toHaveAttribute("data-camera-requests", "preferred preferred default");
	await expect(
		page.getByRole("button", { name: "Replacement camera", exact: true }),
	).toBeVisible();
});

test("editor mode never opens the camera and releases an active recorder preview", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getMediaPermissionStatus = async () => ({
			success: true,
			microphone: "granted",
			camera: "granted",
		});
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
	await expect(page.getByRole("button", { name: "Camera settings" })).toBeVisible();
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
		window.electronAPI.getMediaPermissionStatus = async () => ({
			success: true,
			microphone: "granted",
			camera: "granted",
		});
		const getAppSetting = window.electronAPI.getAppSetting;
		window.electronAPI.getAppSetting = (key) =>
			key === "recordly.editor.preferences.v2"
				? { webcam: { shape: "squircle", roundness: 69, roundnessVersion: 1 } }
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
	await page.getByRole("button", { name: "Camera settings", exact: true }).click();
	await expect(page.locator("[data-floating-webcam-preview]")).toHaveCount(0);
	const camera = page
		.getByRole("dialog", { name: "Camera settings", exact: true })
		.locator("video");
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
	const savedClipPath = getWebcamClipPath(69, 96, 96, "squircle");
	await expect
		.poll(() =>
			camera.evaluate((node, clipPath) => {
				const reference = document.createElement("div");
				reference.style.clipPath = clipPath;
				return getComputedStyle(node).clipPath === reference.style.clipPath;
			}, savedClipPath),
		)
		.toBe(true);
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog", { name: "Camera settings", exact: true })).toHaveCount(0);
	await expect(page.locator("html")).toHaveAttribute("data-shape-camera-stopped", "true");
});
