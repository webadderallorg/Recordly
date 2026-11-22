import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("resolves the chosen microphone and warns when native desktop audio is unavailable", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		let requireMicrophoneAccess = false;
		window.addEventListener("test:lock-microphone-label", () => {
			requireMicrophoneAccess = true;
		});
		navigator.mediaDevices.enumerateDevices = async () =>
			[
				{
					kind: "audioinput",
					deviceId: "usb-mic",
					label: requireMicrophoneAccess ? "" : "USB microphone",
				},
			] as MediaDeviceInfo[];
		navigator.mediaDevices.getUserMedia = async (constraints) => {
			const stream = new MediaStream();
			if (requireMicrophoneAccess) {
				document.documentElement.dataset.requestedMicrophoneAccess =
					JSON.stringify(constraints);
				requireMicrophoneAccess = false;
				stream.getTracks = () => [
					{
						stop: () => {
							document.documentElement.dataset.microphoneAccessReleased = "true";
						},
					} as MediaStreamTrack,
				];
			}
			return stream;
		};
		Object.assign(window.electronAPI, {
			getPlatform: async () => "win32",
			getSelectedSource: async () => ({ id: "window:101:0", name: "Notes" }),
			getCountdownDelay: async () => ({ success: true, delay: 0 }),
			getRecordingPreferences: async () => ({
				success: true,
				systemAudioEnabled: true,
				microphoneEnabled: false,
				webcamEnabled: false,
			}),
			isNativeWindowsCaptureAvailable: async () => ({ available: true }),
			startNativeScreenRecording: async (
				_source: unknown,
				options: { capturesSystemAudio?: boolean; microphoneLabel?: string },
			) => {
				document.documentElement.dataset.nativeMicrophoneLabel =
					options.microphoneLabel ?? "";
				document.documentElement.dataset.nativeSystemAudio = String(
					options.capturesSystemAudio,
				);
				return { success: true, systemAudioCaptureUnavailable: true };
			},
		});
	});

	await page.goto("/?windowType=hud-overlay");
	await page.getByRole("button", { name: "Audio settings", exact: true }).click();
	await page.getByRole("button", { name: /^USB microphone\b/ }).click();
	await page.keyboard.press("Escape");
	await page.evaluate(() => window.dispatchEvent(new Event("test:lock-microphone-label")));
	await page.getByRole("button", { name: "Record", exact: true }).click();
	const html = page.locator("html");
	await expect(html).toHaveAttribute(
		"data-requested-microphone-access",
		JSON.stringify({ audio: { deviceId: { exact: "usb-mic" } } }),
	);
	await expect(html).toHaveAttribute("data-microphone-access-released", "true");
	await expect(html).toHaveAttribute("data-native-microphone-label", "USB microphone");
	await expect(html).toHaveAttribute("data-native-system-audio", "true");
	await expect(page.getByText(/Recording will continue without system audio/)).toBeVisible();
	await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
});
