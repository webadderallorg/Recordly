import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function openSettings(page: Page, entry = "Settings") {
	await page.getByRole("button", { name: "Recordly account", exact: true }).click();
	await page
		.getByRole("dialog", { name: "Account menu", exact: true })
		.getByRole("button", { name: entry, exact: true })
		.click();
	return page.getByRole("dialog", { name: "Settings", exact: true });
}

test("Appearance shortcut opens General settings with wireframe previews and preserves the theme", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	const settings = await openSettings(page, "Appearance");
	await expect(settings.getByRole("tab", { name: "General", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(settings.getByRole("tab")).toHaveText([
		"General",
		"Recording",
		"Motion",
		"Shortcuts",
		"Account",
		...(process.env.RECORDLY_TEST_PRODUCTION === "1" ? [] : ["Dev"]),
	]);
	await expect(settings.getByRole("radio")).toHaveCount(3);
	await expect(
		settings.getByRole("switch", { name: "Experimental updates", exact: true }),
	).toHaveCount(1);
	await settings.getByText("Dark", { exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	await settings.screenshot({
		path: "test-results/app-appearance-dark.png",
		animations: "disabled",
	});
	await page.keyboard.press("Escape");
	await openSettings(page);
	await expect(settings.getByRole("tab", { name: "General", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(settings.getByRole("radiogroup", { name: "Appearance" })).toBeVisible();
	await page.setViewportSize({ width: 420, height: 800 });
	await settings.getByRole("tab", { name: "General", exact: true }).click();
	await expect(settings.getByRole("radio", { name: "Dark", exact: true })).toBeChecked();
	const panel = settings.getByRole("tabpanel");
	expect(await panel.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
	await settings.screenshot({
		path: "test-results/app-appearance-narrow.png",
		animations: "disabled",
	});
});

test("Storage shows both locations, opens each folder and explains future-only changes", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.openRecordingsFolder = async () => {
			document.documentElement.dataset.openedFolder = "recordings";
			return { success: true };
		};
		window.electronAPI.openProjectsDirectory = async () => {
			document.documentElement.dataset.openedFolder = "projects";
			return { success: true, path: "/projects" };
		};
	});
	await page.goto("/?windowType=editor");
	const settings = await openSettings(page);
	await settings.getByRole("tab", { name: "General", exact: true }).click();
	await expect(settings.getByText("/recordings", { exact: true })).toBeVisible();
	await expect(settings.getByText("/projects", { exact: true })).toBeVisible();
	await settings.getByRole("button", { name: "Open folder", exact: true }).nth(0).click();
	await expect(page.locator("html")).toHaveAttribute("data-opened-folder", "recordings");
	await settings.getByRole("button", { name: "Open folder", exact: true }).nth(1).click();
	await expect(page.locator("html")).toHaveAttribute("data-opened-folder", "projects");
	await settings.getByRole("button", { name: "Change folder", exact: true }).click();
	await expect(settings.getByText("/new-recordings", { exact: true })).toBeVisible();
	await expect(
		settings.getByRole("status").filter({ hasText: "Existing recordings have not been moved" }),
	).toBeVisible();
	await settings.screenshot({ path: "test-results/app-storage.png", animations: "disabled" });
});

test("Updates shows version, checks status and preserves channel on failure", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getUpdateStatusSummary = async () => ({
			status: document.documentElement.dataset.checked ? "up-to-date" : "idle",
			currentVersion: "1.4.0",
			availableVersion: null,
		});
		window.electronAPI.checkForAppUpdates = async () => {
			document.documentElement.dataset.checked = "true";
			return { success: true, logPath: "/logs" };
		};
		window.electronAPI.setExperimentalUpdatesEnabled = async () => ({
			success: false,
			enabled: false,
		});
	});
	await page.goto("/?windowType=editor");
	const settings = await openSettings(page);
	await settings.getByRole("tab", { name: "General", exact: true }).click();
	await expect(settings.getByText("1.4.0", { exact: true })).toBeVisible();
	await settings.getByRole("button", { name: "Check for updates", exact: true }).click();
	await expect(settings.getByRole("status")).toHaveText("Recordly is up to date.");
	const toggle = settings.getByRole("switch", { name: "Experimental updates", exact: true });
	await toggle.focus();
	await toggle.press("Space");
	await expect(settings.getByRole("alert")).toContainText("Failed to change the update channel.");
	await expect(settings.getByRole("button", { name: "Report Error", exact: true })).toBeVisible();
	await expect(toggle).not.toBeChecked();
	await settings.screenshot({ path: "test-results/app-updates.png", animations: "disabled" });
});

test("Motion represents custom settings truthfully before applying a preset", async ({ page }) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	await page.getByRole("radio", { name: "Cursor", exact: true }).click();
	const size = page.getByRole("slider", { name: "Cursor Size", exact: true });
	await size.focus();
	await size.press("Home");
	await size.press("ArrowRight");
	const settings = await openSettings(page);
	await settings.getByRole("tab", { name: "Motion", exact: true }).click();
	await expect(
		settings.getByText("Custom · Your settings differ from these presets.", { exact: true }),
	).toBeVisible();
	const focused = settings.getByRole("radio", { name: /^Focused/ });
	await expect(focused).not.toBeChecked();
	await settings.getByText("Focused", { exact: true }).click();
	await expect(focused).toBeChecked();
	await expect(
		settings.getByText("Custom · Your settings differ from these presets.", { exact: true }),
	).toHaveCount(0);
	await settings.screenshot({ path: "test-results/app-motion.png", animations: "disabled" });
});

test("dashboard profile deep links work repeatedly after internal category changes", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const home = page.getByRole("dialog", { name: "Projects dashboard", exact: true });
	const choose = async (entry: string) => {
		await home.getByRole("button", { name: "Recordly account", exact: true }).click();
		await page
			.getByRole("dialog", { name: "Account menu", exact: true })
			.getByRole("button", { name: entry, exact: true })
			.click();
	};
	await choose("Appearance");
	await home.getByRole("tab", { name: "Motion", exact: true }).click();
	await choose("Appearance");
	await expect(home.getByRole("tab", { name: "General", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await home.getByRole("tab", { name: "Account", exact: true }).click();
	await choose("Settings");
	await expect(home.getByRole("tab", { name: "General", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
});

test("Updates recovers from failed checks and failed channel loading", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getExperimentalUpdatesEnabled = async () => {
			if (document.documentElement.dataset.channelRetry !== "true")
				throw Error("Unavailable");
			return false;
		};
		window.electronAPI.checkForAppUpdates = async () => {
			throw Error("Network unavailable");
		};
	});
	await page.goto("/?windowType=editor");
	const settings = await openSettings(page);
	await settings.getByRole("tab", { name: "General", exact: true }).click();
	const toggle = settings.getByRole("switch", { name: "Experimental updates", exact: true });
	await expect(toggle).toBeDisabled();
	await page.evaluate(() => {
		document.documentElement.dataset.channelRetry = "true";
	});
	await settings.getByRole("button", { name: "Try again", exact: true }).click();
	await expect(toggle).toBeEnabled();
	const check = settings.getByRole("button", { name: "Check for updates", exact: true });
	await check.click();
	await expect(settings.getByRole("alert")).toContainText(
		"Could not check for updates. Try again.",
	);
	await expect(settings.getByText("Network unavailable", { exact: true })).toBeHidden();
	await settings.getByRole("button", { name: "Technical details", exact: true }).click();
	await expect(settings.getByText("Network unavailable", { exact: true })).toBeVisible();
	await expect(check).toBeEnabled();
});

test("Appearance and permission states use the selected application language", async ({ page }) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => localStorage.setItem("recordly.locale", "ko"));
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Recordly 계정", exact: true }).click();
	await page
		.getByRole("dialog", { name: "계정 메뉴", exact: true })
		.getByRole("button", { name: "모양", exact: true })
		.click();
	const settings = page.getByRole("dialog", { name: "설정", exact: true });
	await expect(settings.getByRole("radio", { name: "시스템", exact: true })).toHaveCount(1);
	await expect(settings.getByRole("radio", { name: "라이트", exact: true })).toHaveCount(1);
	await expect(settings.getByRole("radio", { name: "다크", exact: true })).toHaveCount(1);
	await settings.getByRole("tab", { name: "녹화", exact: true }).click();
	await expect(settings.getByText("마이크", { exact: true })).toBeVisible();
	await expect(settings.getByText("카메라", { exact: true })).toBeVisible();
	await expect(settings.getByText("요청하지 않음", { exact: true })).toBeVisible();
	await expect(settings.getByText("허용되지 않음", { exact: true })).toBeVisible();
	await settings.screenshot({
		path: "test-results/app-settings-korean.png",
		animations: "disabled",
	});
});

test("small success and error status text stays readable in both themes", async ({ page }) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	for (const theme of ["Light", "Dark"]) {
		const settings = await openSettings(page, "Appearance");
		await settings.getByText(theme, { exact: true }).click();
		await settings.getByRole("tab", { name: "Recording", exact: true }).click();
		await expect(settings.getByText("Allowed", { exact: true })).toHaveCount(2);
		const contrasts = await settings
			.getByText("Allowed", { exact: true })
			.first()
			.evaluate((element) => {
				const canvas = document.createElement("canvas");
				canvas.width = canvas.height = 1;
				const context = canvas.getContext("2d")!;
				const luminance = (color: string) => {
					context.clearRect(0, 0, 1, 1);
					context.fillStyle = color;
					context.fillRect(0, 0, 1, 1);
					const pixel = context.getImageData(0, 0, 1, 1).data;
					const linear = Array.from(pixel)
						.slice(0, 3)
						.map((v) => {
							const c = v / 255;
							return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
						});
					return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
				};
				const background = luminance(
					getComputedStyle(element.closest('[role="dialog"]')!).backgroundColor,
				);
				const style = getComputedStyle(element);
				const colors = [style.color, style.getPropertyValue("--danger")];
				return colors.map((color) => {
					const value = luminance(color);
					return (
						(Math.max(value, background) + 0.05) / (Math.min(value, background) + 0.05)
					);
				});
			});
		for (const ratio of contrasts) expect(ratio).toBeGreaterThanOrEqual(4.5);
		await page.keyboard.press("Escape");
	}
});

test("filled bottom-left settings button opens General without leaving the editor", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	const rail = page.getByRole("navigation", { name: "Editor tools", exact: true });
	const trigger = rail.getByRole("button", { name: "Settings", exact: true });
	await expect(trigger).toBeVisible({ timeout: 60000 });
	await expect(trigger.locator("svg")).toHaveAttribute("data-icon-style", "bold");
	const railBox = await rail.boundingBox();
	const buttonBox = await trigger.boundingBox();
	expect(buttonBox!.y + buttonBox!.height).toBeGreaterThan(railBox!.y + railBox!.height - 20);
	await page.screenshot({
		path: "test-results/editor-settings-button.png",
		animations: "disabled",
	});
	await trigger.click();
	const settings = page.getByRole("dialog", { name: "Settings", exact: true });
	await expect(settings).toBeVisible();
	await expect(settings.getByRole("tab", { name: "General", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await settings.getByRole("tab", { name: "Motion", exact: true }).click();
	await page.keyboard.press("Escape");
	await expect(settings).not.toBeVisible();
	await expect(trigger).toBeFocused();
	await trigger.press("Enter");
	await expect(settings.getByRole("tab", { name: "General", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(
		page.getByRole("dialog", { name: "Projects dashboard", exact: true }),
	).not.toBeVisible();
});

test("device permission actions request native access on click and handle denial", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getMediaPermissionStatus = async () => ({
			success: true,
			microphone: document.documentElement.dataset.microphoneGranted
				? "granted"
				: "not-determined",
			camera: document.documentElement.dataset.cameraDenied ? "denied" : "not-determined",
		});
		window.electronAPI.requestMediaPermission = async (device) => {
			document.documentElement.dataset.requestedMedia = device;
			if (device === "camera") {
				document.documentElement.dataset.cameraDenied = "true";
				return { success: true, granted: false };
			}
			document.documentElement.dataset.microphoneGranted = "true";
			return { success: true, granted: true };
		};
	});
	await page.goto("/?windowType=editor");
	const settings = await openSettings(page);
	await settings.getByRole("tab", { name: "Recording", exact: true }).click();
	await expect(page.locator("html")).not.toHaveAttribute("data-requested-media");
	await settings.getByRole("button", { name: "Allow microphone", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-requested-media", "microphone");
	await expect(
		settings.getByRole("button", { name: "Allow microphone", exact: true }),
	).toHaveCount(0);
	await settings.getByRole("button", { name: "Allow camera", exact: true }).click();
	await expect(
		settings.getByRole("button", { name: "Open System Settings: Camera", exact: true }),
	).toBeVisible();
	await expect(settings.getByRole("alert")).toHaveCount(0);
	await page.setViewportSize({ width: 420, height: 800 });
	await expect
		.poll(() =>
			settings
				.getByRole("tabpanel")
				.evaluate((element) => element.scrollWidth - element.clientWidth),
		)
		.toBeLessThanOrEqual(0);
});
