import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

for (const cancel of ["none", "pointer", "escape"] as const) {
	test(`countdown stays inside the record button and ${cancel === "none" ? "starts after 3/2/1" : `cancels via ${cancel}`}`, async ({
		page,
	}) => {
		await installDesktopBridge(page);
		await installDesktopBridgeOverrides(page, () => {
			const ticks = new Set<(seconds: number) => void>();
			let finish: ((result: { success: boolean; cancelled?: boolean }) => void) | undefined;
			let timer: ReturnType<typeof setInterval> | undefined;
			let remaining: number | null = null;
			Object.assign(window.electronAPI, {
				getActiveCountdown: async () => ({ success: true, seconds: remaining }),
				onCountdownTick: (callback: (seconds: number) => void) => {
					ticks.add(callback);
					return () => ticks.delete(callback);
				},
				startCountdown: (seconds: number) =>
					new Promise((resolve) => {
						remaining = seconds;
						finish = resolve;
						ticks.forEach((tick) => tick(seconds));
						timer = setInterval(() => {
							remaining = (remaining ?? 0) - 1;
							ticks.forEach((tick) => tick(remaining ?? 0));
							if (remaining <= 0) {
								clearInterval(timer);
								remaining = null;
								finish?.({ success: true });
							}
						}, 1000);
					}),
				cancelCountdown: async () => {
					clearInterval(timer);
					remaining = null;
					ticks.forEach((tick) => tick(0));
					finish?.({ success: false, cancelled: true });
					return { success: true };
				},
				startNativeScreenRecording: async () => ({ success: true }),
				pauseNativeScreenRecording: async () => ({ success: true }),
				resumeNativeScreenRecording: async () => {
					document.documentElement.dataset.captureResumed = "true";
					return { success: true };
				},
				stopNativeScreenRecording: async () => ({
					success: true,
					path: "/cancelled-take.mp4",
				}),
				deleteRecordingFile: async () => {
					document.documentElement.dataset.captureDeleted = "true";
					return { success: true };
				},
			});
		});
		await page.goto("/?windowType=hud-overlay");
		const bar = page.locator("[data-recording-state]");
		const record = page.getByRole("button", { name: "Record", exact: true });
		await expect(record).toBeEnabled();
		const before = await bar.boundingBox();
		await record.click();
		const countdown = page.getByRole("button", { name: "Cancel countdown", exact: true });
		await expect(countdown.getByRole("status")).toHaveText("3");
		await page.mouse.move(0, 0);
		expect(await bar.boundingBox()).toEqual(before);
		if (cancel !== "none") {
			if (cancel === "pointer") {
				await countdown.hover();
				await expect(countdown.locator("svg")).toHaveCSS("opacity", "1");
				await countdown.click();
			} else await page.keyboard.press("Escape");
			await expect(page.getByRole("button", { name: "Record", exact: true })).toBeVisible();
			await expect(page.locator("html")).toHaveAttribute("data-capture-deleted", "true");
			expect(await page.locator("html").getAttribute("data-capture-resumed")).toBeNull();
		} else {
			await expect(countdown.getByRole("status")).toHaveText("2");
			await expect(countdown.getByRole("status")).toHaveText("1");
			await expect(
				page.getByRole("group", { name: "Recording controls", exact: true }),
			).toBeVisible();
			await expect(page.locator("html")).toHaveAttribute("data-capture-resumed", "true");
			await expect(page.getByRole("button", { name: "Hide HUD", exact: true })).toHaveCount(
				0,
			);
		}
	});
}

test("compact microphone and camera selectors preserve their original choices", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getEditorMode = async () => true;
		navigator.mediaDevices.enumerateDevices = async () =>
			[
				{
					kind: "videoinput",
					deviceId: "camera-main",
					label: "Built-in camera",
					groupId: "camera",
				},
			] as MediaDeviceInfo[];
	});
	await page.goto("/?windowType=hud-overlay");
	const microphone = page.getByRole("button", { name: "Enable microphone", exact: true });
	await expect(microphone).toHaveText("");
	await microphone.click();
	await expect(page.getByText("Microphone", { exact: true })).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Disable system audio", exact: true }),
	).toBeVisible();
	await expect(page.getByText("Select a microphone to enable", { exact: true })).toBeVisible();
	await page.keyboard.press("Escape");
	const camera = page.getByRole("button", { name: "Enable webcam overlay", exact: true });
	await expect(camera).toHaveText("");
	await camera.click();
	await expect(page.getByText("Webcam", { exact: true })).toBeVisible();
	await expect(page.getByText("Select a webcam to enable", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Built-in camera", exact: true })).toBeVisible();
	await page
		.locator("[data-recording-state]")
		.screenshot({ path: "test-results/recorder-restored-selectors.png" });
});
