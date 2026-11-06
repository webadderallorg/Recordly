import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("Stop keeps the Finishing HUD until a recording is ready, then opens the editor", async ({
	page,
	context,
}) => {
	test.setTimeout(60000);
	const editor = await context.newPage();
	await installDesktopBridge(editor);
	await editor.addInitScript(() => {
		let complete!: () => void;
		const pending = new Promise<void>((resolve) => {
			complete = resolve;
		});
		Object.assign(window, { completeRecording: complete });
		window.electronAPI.waitForRecordingEditor = async () => {
			await pending;
			return {};
		};
	});
	await installDesktopBridge(page);
	let opened = false;
	await page.exposeFunction("openTestEditor", async () => {
		opened = true;
		await editor.goto("/?windowType=editor");
		return { success: true };
	});
	let releaseEditor!: () => void;
	const pendingEditor = new Promise<void>((resolve) => {
		releaseEditor = resolve;
	});
	await page.exposeFunction("finishTestEditor", async () => {
		await pendingEditor;
		await editor.evaluate(() =>
			(window as unknown as { completeRecording: () => void }).completeRecording(),
		);
	});
	await page.addInitScript(() => {
		const testWindow = window as unknown as {
			openTestEditor: () => Promise<{ success: boolean }>;
			finishTestEditor: () => Promise<void>;
		};
		Object.assign(window.electronAPI, {
			getPlatform: async () => "darwin",
			getCountdownDelay: async () => ({ success: true, delay: 0 }),
			getRecordingPreferences: async () => ({
				success: true,
				microphoneEnabled: false,
				webcamEnabled: false,
				systemAudioEnabled: false,
			}),
			startNativeScreenRecording: async () => ({ success: true }),
			stopNativeScreenRecording: () =>
				new Promise((resolve) => {
					document.documentElement.dataset.nativeStopPending = "true";
					window.addEventListener(
						"release-native-stop",
						() => {
							document.documentElement.dataset.nativeStopPending = "false";
							resolve({ success: true, path: "/take.mp4" });
						},
						{ once: true },
					);
				}),
			openLoadingRecordingEditor: testWindow.openTestEditor,
			finishRecordingEditor: testWindow.finishTestEditor,
		});
	});
	await page.goto("/?windowType=hud-overlay");
	await page.getByRole("button", { name: "Record", exact: true }).click();
	const controls = page.getByRole("group", { name: "Recording controls", exact: true });
	await expect(controls.getByRole("timer")).not.toHaveText("0:00");
	await controls.getByRole("button", { name: "Stop", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-native-stop-pending", "true");
	await expect(page.locator('[data-recording-state="finalizing"]')).toBeVisible();
	expect(opened).toBe(false);
	await page.evaluate(() => window.dispatchEvent(new Event("release-native-stop")));
	await expect.poll(() => opened).toBe(true);
	await expect(editor.getByRole("status", { name: "Loading editor", exact: true })).toBeVisible();
	await expect(editor.locator(".loading-recordly-mark")).toBeVisible();
	await editor.screenshot({
		path: "/tmp/recordly-editor-finalization-20261105/loading-editor.png",
	});
	releaseEditor();
	await expect(editor.getByRole("navigation", { name: "Editor tools" })).toBeVisible({
		timeout: 30000,
	});
	await expect(editor.getByRole("status", { name: "Loading editor", exact: true })).toHaveCount(
		0,
	);
});
