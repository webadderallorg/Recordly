import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

for (const resource of ["microphone", "cursor"] as const) {
	test(`changing source during startup releases the ${resource} before picking`, async ({
		page,
	}) => {
		await installDesktopBridge(page);
		await page.addInitScript((resource) => {
			let releaseCapture!: () => void;
			const capturePending = new Promise<void>((resolve) => {
				releaseCapture = resolve;
			});
			const track = {
				kind: resource === "microphone" ? "audio" : "video",
				stop: () => {
					document.documentElement.dataset.trackStopped = "true";
				},
				getSettings: () => ({ width: 1920, height: 1080, frameRate: 30 }),
				applyConstraints: async () => undefined,
			};
			const mediaStream = {
				getTracks: () => [track],
				getAudioTracks: () => (resource === "microphone" ? [track] : []),
				getVideoTracks: () => (resource === "cursor" ? [track] : []),
			};
			Object.defineProperties(navigator.mediaDevices, {
				getUserMedia: {
					value: async () => {
						document.documentElement.dataset.acquiringCapture = "true";
						await capturePending;
						return mediaStream;
					},
				},
				enumerateDevices: { value: async () => [] },
			});
			class MockRecorder {
				state = "inactive";
				mimeType = "audio/webm;codecs=opus";
				constructor(public stream: unknown) {}
				static isTypeSupported() {
					return true;
				}
				start() {
					this.state = "recording";
					document.documentElement.dataset.recorderStarted = "true";
				}
				stop() {
					this.state = "inactive";
				}
			}
			Object.assign(window, { MediaRecorder: MockRecorder });
			Object.assign(window.electronAPI, {
				getPlatform: async () => (resource === "microphone" ? "darwin" : "win32"),
				getSelectedSource: async () => ({ id: "window:101:0", name: "Notes" }),
				getCountdownDelay: async () => ({ success: true, delay: 0 }),
				getRecordingPreferences: async () => ({
					success: true,
					microphoneEnabled: resource === "microphone",
					systemAudioEnabled: false,
					webcamEnabled: false,
				}),
				startNativeScreenRecording: async () => ({
					success: true,
					microphoneFallbackRequired: true,
				}),
				stopNativeScreenRecording: async () => ({ success: true, path: "/pending.mp4" }),
				deleteRecordingFile: async () => ({ success: true }),
				isNativeWindowsCaptureAvailable: async () => ({ available: false }),
				hideOsCursor: async () => {
					document.documentElement.dataset.cursorHidden = "true";
					return { success: true };
				},
				setRecordingState: async (active: boolean) => {
					if (!active) document.documentElement.dataset.cursorHidden = "false";
				},
				cancelCountdown: async () => {
					releaseCapture();
					return { success: true };
				},
				pickCaptureTarget: async () => {
					const html = document.documentElement;
					html.dataset.resourceReleasedBeforePick = String(
						resource === "microphone"
							? html.dataset.trackStopped === "true"
							: html.dataset.cursorHidden === "false",
					);
					return { success: false, canceled: true };
				},
			});
		}, resource);
		await page.goto("/?windowType=hud-overlay");
		const source = page.getByRole("button", { name: "Choose recording source" });
		await expect(source).toBeEnabled({ timeout: 15000 });
		await page.getByRole("button", { name: "Record", exact: true }).click();
		await expect(page.locator("html")).toHaveAttribute("data-acquiring-capture", "true");
		await source.click();
		await expect(page.locator("html")).toHaveAttribute(
			"data-resource-released-before-pick",
			"true",
		);
		await expect(page.locator("html")).toHaveAttribute("data-track-stopped", "true");
		await expect(page.locator("html")).not.toHaveAttribute("data-recorder-started");
		await expect(page.getByRole("button", { name: "Record", exact: true })).toBeEnabled();
	});
}
