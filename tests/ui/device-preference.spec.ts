import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

for (const webcamEnabled of [true, false]) {
	test(`HUD restores the saved camera when webcam starts ${webcamEnabled ? "enabled" : "disabled"}`, async ({
		page,
	}) => {
		await installDesktopBridge(page);
		await page.addInitScript((enabled) => {
			Object.assign(window, { __testWebcamEnabled: enabled });
		}, webcamEnabled);
		await installDesktopBridgeOverrides(page, () => {
			const writes: string[] = [];
			Object.assign(window, { __testCameraWrites: writes });
			window.electronAPI.getEditorMode = async () => true;
			window.electronAPI.getRecordingPreferences = async () => ({
				success: true,
				microphoneEnabled: false,
				systemAudioEnabled: false,
				webcamEnabled: (window as unknown as { __testWebcamEnabled: boolean })
					.__testWebcamEnabled,
				webcamDeviceId: "camera-saved",
			});
			window.electronAPI.setRecordingPreferences = async (preferences) => {
				if (preferences.webcamDeviceId) writes.push(preferences.webcamDeviceId);
				return { success: true };
			};
			Object.defineProperty(navigator.mediaDevices, "enumerateDevices", {
				value: async () => [
					{
						deviceId: "camera-first",
						kind: "videoinput",
						label: "Built-in camera",
						groupId: "first",
					},
					{
						deviceId: "camera-saved",
						kind: "videoinput",
						label: "Saved external camera",
						groupId: "saved",
					},
				],
			});
		});
		await page.goto("/?windowType=hud-overlay");
		await page
			.getByRole("button", {
				name: webcamEnabled ? "Disable webcam overlay" : "Enable webcam overlay",
				exact: true,
			})
			.click();
		const camera = page.getByRole("button", { name: "Saved external camera", exact: true });
		await expect(camera).toBeVisible();
		if (webcamEnabled) await expect(camera).toHaveAttribute("aria-pressed", "true");
		else await camera.click();
		await expect(camera).toHaveAttribute("aria-pressed", "true");
		await expect(
			page.getByRole("button", { name: "Built-in camera", exact: true }),
		).toHaveAttribute("aria-pressed", "false");
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						(window as unknown as { __testCameraWrites: string[] }).__testCameraWrites,
				),
			)
			.toEqual(expect.arrayContaining(["camera-saved"]));
		expect(
			await page.evaluate(
				() => (window as unknown as { __testCameraWrites: string[] }).__testCameraWrites,
			),
		).not.toContain("camera-first");
	});
}
