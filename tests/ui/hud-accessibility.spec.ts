import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("HUD controls describe the active source, audio, camera and countdown", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		let source = { id: "screen:1:0", name: "Built-in display" };
		window.electronAPI.getPlatform = async () => "win32";
		window.electronAPI.getSelectedSource = async () => source;
		window.electronAPI.pickCaptureTarget = async () => {
			source = { id: "window:101:0", name: "Selected window" };
			return { success: true, source };
		};
	});
	await page.goto("/?windowType=hud-overlay");
	const setup = page.getByRole("group", { name: "Recording setup", exact: true });
	const source = setup.getByRole("button", { name: "Choose recording source", exact: true });
	const audio = setup.getByRole("button", { name: "Audio settings", exact: true });
	const camera = setup.getByRole("button", { name: "Camera settings", exact: true });
	const countdown = setup.getByRole("button", { name: "Countdown delay", exact: true });
	await expect(source).toHaveAccessibleDescription("Built-in display");
	await expect(audio).toHaveAccessibleDescription("Microphone: Off. Computer audio: On");
	await expect(camera).toHaveAccessibleDescription("Off");
	await expect(countdown).toHaveAccessibleDescription("3 seconds");

	await audio.focus();
	await expect(audio).toHaveAccessibleDescription(/Microphone: Off.*Computer audio: On/);
	await page.keyboard.press("Enter");
	const computerAudio = page.getByRole("button", { name: "Computer audio", exact: true });
	await computerAudio.focus();
	await page.keyboard.press("Space");
	await page.keyboard.press("Escape");
	await expect(audio).toHaveAccessibleDescription(/Microphone: Off.*Computer audio: Off/);
	await source.focus();
	await page.keyboard.press("Enter");
	await expect(source).toHaveAccessibleDescription(/Selected window/);
	await countdown.focus();
	await page.keyboard.press("Enter");
	const noDelay = page.getByRole("button", { name: "No delay", exact: true });
	await noDelay.focus();
	await page.keyboard.press("Space");
	await expect(countdown).toHaveAccessibleDescription(/No delay/);
});

test("the same status region announces recording, pause and finalization", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		Object.assign(window.electronAPI, {
			getPlatform: async () => "win32",
			getSelectedSource: async () => ({ id: "screen:1:0", name: "Built-in display" }),
			getCountdownDelay: async () => ({ success: true, delay: 0 }),
			isNativeWindowsCaptureAvailable: async () => ({ available: true }),
			startNativeScreenRecording: async () => ({ success: true }),
			pauseNativeScreenRecording: async () => ({ success: true }),
			resumeNativeScreenRecording: async () => ({ success: true }),
			stopNativeScreenRecording: () =>
				new Promise((resolve) =>
					window.addEventListener(
						"test-release-native-stop",
						() => resolve({ success: true, path: "/screen.mp4" }),
						{ once: true },
					),
				),
		});
	});
	await page.goto("/?windowType=hud-overlay");
	const status = page.locator('[role="status"][aria-atomic="true"]');
	await expect(status).toHaveCount(1);
	await status.evaluate((element) => element.setAttribute("data-tested-announcement", "true"));
	const announcement = page.locator('[data-tested-announcement="true"]');
	await expect(announcement).toBeEmpty();
	await page.getByRole("button", { name: "Record", exact: true }).click();
	await expect(announcement).toHaveText("Recording");
	const controls = page.getByRole("group", { name: "Recording controls", exact: true });
	await expect(controls.getByRole("timer")).toHaveAttribute("aria-live", "off");
	await controls.getByRole("button", { name: "Pause", exact: true }).click();
	await expect(announcement).toHaveText("PAUSED");
	await controls.getByRole("button", { name: "Resume", exact: true }).click();
	await expect(announcement).toHaveText("Recording");
	await controls.getByRole("button", { name: "Stop", exact: true }).click();
	await expect(announcement).toHaveText("Finishing recording…");
	await page.evaluate(() => window.dispatchEvent(new Event("test-release-native-stop")));
});

test("Linux source list announces an empty result and describes the source type", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		let first = true;
		window.electronAPI.getPlatform = async () => "linux";
		window.electronAPI.getSources = async () => {
			if (first) {
				first = false;
				return new Promise<ProcessedDesktopSource[]>((resolve) =>
					window.addEventListener("test-empty-sources", () => resolve([]), {
						once: true,
					}),
				);
			}
			return [
				{ id: "screen:1:0", name: "Primary display", display_id: "1" },
				{ id: "window:101:0", name: "Document" },
			];
		};
	});
	await page.goto("/?windowType=source-selector");
	const status = page.getByRole("status");
	await expect(status).toHaveText("Loading sources…");
	await page.evaluate(() => window.dispatchEvent(new Event("test-empty-sources")));
	await expect(status).toHaveText("No recording sources found.");
	await page.getByRole("button", { name: "Refresh", exact: true }).click();
	await expect(page.getByRole("button", { name: "Primary display" })).toHaveAccessibleDescription(
		"Screen",
	);
	await expect(page.getByRole("button", { name: "Document" })).toHaveAccessibleDescription(
		"Window",
	);
});
