import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

for (const failure of ["none", "stop", "delete", "delete-result"] as const) {
	test(`HUD discard returns to setup only after capture cleanup (${failure})`, async ({
		page,
	}) => {
		test.setTimeout(60000);
		await installDesktopBridge(page);
		await page.addInitScript((failure) => {
			let starts = 0;
			const events: string[] = [];
			const event = (name: string) => {
				events.push(name);
				document.documentElement.dataset.captureEvents = events.join(",");
			};
			Object.assign(window.electronAPI, {
				setRecordingState: async () => ({ success: true }),
				pauseNativeScreenRecording: async () => ({ success: true }),
				resumeNativeScreenRecording: async () => ({ success: true }),
				getPlatform: async () => "darwin",
				getSelectedSource: async () => ({ id: "screen:1:0", name: "Built-in Display" }),
				getCountdownDelay: async () => ({ success: true, delay: 0 }),
				getRecordingPreferences: async () => ({
					success: true,
					microphoneEnabled: false,
					webcamEnabled: false,
					systemAudioEnabled: false,
				}),
				startNativeScreenRecording: async () => {
					starts += 1;
					event(`start-${starts}`);
					return { success: true };
				},
				stopNativeScreenRecording: () => {
					event("stop");
					return new Promise((resolve) =>
						window.addEventListener(
							"release-native-stop",
							() =>
								resolve(
									failure === "stop"
										? { success: false, error: "Capture is busy" }
										: { success: true, path: "/discard.mp4" },
								),
							{ once: true },
						),
					);
				},
				deleteRecordingFile: async () => {
					event("delete");
					if (failure === "delete") throw new Error("Could not delete the take");
					if (failure === "delete-result") return { success: false, error: "File is locked" };
					return { success: true };
				},
			});
		}, failure);
		await page.goto("/?windowType=hud-overlay");
		const record = page.getByRole("button", { name: "Record", exact: true });
		await expect(record).toBeEnabled({ timeout: 30000 });
		await record.click();
		const controls = page.getByRole("group", { name: "Recording controls", exact: true });
		await expect(controls).toBeVisible();
		await expect(controls.getByRole("timer")).not.toHaveText("0:00");
		if (failure === "stop") {
			await controls.getByRole("button", { name: "Pause", exact: true }).click();
			await expect(
				controls.getByRole("button", { name: "Resume", exact: true }),
			).toBeVisible();
		}
		const bounds = await controls.boundingBox();
		const discard = controls.getByRole("button", { name: "Discard recording", exact: true });
		await discard.click();
		await expect(page.locator("html")).toHaveAttribute("data-capture-events", "start-1,stop");
		await expect(discard).toBeDisabled();
		expect(await controls.boundingBox()).toEqual(bounds);
		await page.evaluate(() => window.dispatchEvent(new Event("release-native-stop")));
		if (failure === "stop") {
			await expect(discard).toBeEnabled();
			await expect(
				controls.getByRole("button", { name: "Resume", exact: true }),
			).toBeVisible();
			await expect(page.locator("html")).toHaveAttribute(
				"data-capture-events",
				"start-1,stop",
			);
		} else {
			await expect(record).toBeVisible();
			await expect(
				page.getByRole("group", { name: "Recording setup", exact: true }),
			).toBeVisible();
			await expect(page.locator("html")).toHaveAttribute(
				"data-capture-events",
				"start-1,stop,delete",
			);
			if (failure === "none") {
				await record.click();
				await expect(controls).toBeVisible();
				await expect(page.locator("html")).toHaveAttribute("data-capture-events", "start-1,stop,delete,start-2");
			} else {
				await record.click();
				await expect(page.locator("html")).toHaveAttribute("data-capture-events", "start-1,stop,delete,delete");
				await expect(record).toBeEnabled();
			}
		}
	});
}
