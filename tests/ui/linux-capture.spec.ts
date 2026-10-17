import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function openLinuxList(page: Page, stale = false) {
	await page.setViewportSize({ width: 620, height: 420 });
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(
		page,
		(stale) => {
			const sources = [
				{ id: "screen:1:0", name: "Screen 1 (Primary)", display_id: "1" },
				{ id: "window:101:0", name: "Document" },
			];
			Object.defineProperty(window, "close", {
				value: () => {
					document.documentElement.dataset.closed = "true";
				},
			});
			Object.assign(window.electronAPI, {
				getPlatform: async () => "linux",
				getSources: async () => {
					const html = document.documentElement;
					html.dataset.refreshes = String(Number(html.dataset.refreshes ?? 0) + 1);
					return sources;
				},
				pickCaptureTarget: async () => {
					throw new Error("Linux must use the list");
				},
				selectSource: async (source) => {
					if (stale)
						throw new Error(
							"That window or screen is no longer available. Refresh the source list.",
						);
					document.documentElement.dataset.selected = source.id;
					return source;
				},
				onRecordingStateChanged: (callback) => {
					const listener = () => callback({ recording: true });
					window.addEventListener("test-recording-start", listener);
					return () => window.removeEventListener("test-recording-start", listener);
				},
			});
		},
		stale,
	);
	await page.goto("/?windowType=source-selector");
	await expect(page.getByRole("heading", { name: "Choose recording source" })).toBeVisible({
		timeout: 15000,
	});
	await expect(page.getByRole("button", { name: "Document", exact: true })).toBeVisible();
}

test("Linux lists screens and windows and selects the requested window", async ({
	page,
}, testInfo) => {
	await openLinuxList(page);
	await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeInViewport();
	await page.screenshot({ path: testInfo.outputPath("linux-source-list.png") });
	await expect(page.getByRole("heading", { name: "Screens", exact: true })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Windows", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Document", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-selected", "window:101:0");
});

test("a closed Linux window leaves the picker open and allows refresh", async ({ page }) => {
	await openLinuxList(page, true);
	await page.getByRole("button", { name: "Document", exact: true }).click();
	await expect(page.getByRole("alert")).toContainText("no longer available");
	await expect(page.locator("html")).not.toHaveAttribute("data-closed");
	await expect(page.locator("html")).not.toHaveAttribute("data-selected");
	const before = Number(await page.locator("html").getAttribute("data-refreshes"));
	await page.getByRole("button", { name: "Refresh", exact: true }).click();
	await expect
		.poll(async () => Number(await page.locator("html").getAttribute("data-refreshes")))
		.toBeGreaterThan(before);
	await expect(page.getByRole("alert")).toHaveCount(0);
});

for (const trigger of ["Escape", "Cancel", "recording"]) {
	test(`Linux source list closes on ${trigger} without selecting a source`, async ({ page }) => {
		await openLinuxList(page);
		if (trigger === "Escape") await page.keyboard.press("Escape");
		else if (trigger === "Cancel")
			await page.getByRole("button", { name: "Cancel", exact: true }).click();
		else await page.evaluate(() => window.dispatchEvent(new Event("test-recording-start")));
		await expect(page.locator("html")).toHaveAttribute("data-closed", "true");
		await expect(page.locator("html")).not.toHaveAttribute("data-selected");
	});
}

test("dismissing the Wayland portal cleans up without a second prompt or alert", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		Object.assign(window.electronAPI, {
			getPlatform: async () => "linux",
			getSelectedSource: async () => ({ id: "screen:linux-portal", name: "System picker" }),
			getSources: async () => {
				throw new Error("Must not enumerate Wayland sources");
			},
			startCountdown: async () => ({ success: true, cancelled: false }),
			setRecordingState: async (active: boolean) => {
				document.documentElement.dataset.recording = String(active);
			},
			finishRecordingStartup: async () => {
				document.documentElement.dataset.startupFinished = "true";
			},
		});
		Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
			value: async () => {
				const html = document.documentElement;
				html.dataset.portalCalls = String(Number(html.dataset.portalCalls ?? 0) + 1);
				throw new DOMException("Cancelled", "NotAllowedError");
			},
		});
		window.alert = (message) => {
			document.documentElement.dataset.alert = String(message);
		};
	});
	await page.goto("/?windowType=hud-overlay");
	await expect(page.getByRole("button", { name: "Choose recording source" })).toContainText(
		"System picker",
		{ timeout: 15000 },
	);
	await page.getByRole("button", { name: "Record", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-startup-finished", "true");
	await expect(page.locator("html")).toHaveAttribute("data-portal-calls", "1");
	await expect(page.locator("html")).toHaveAttribute("data-recording", "false");
	await expect(page.locator("html")).not.toHaveAttribute("data-alert");
	await expect(page.getByRole("button", { name: "Record", exact: true })).toBeEnabled();
});
