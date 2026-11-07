import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";
import { productionTest } from "./production";

async function installSettingsBridge(page: Page) {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		let preferences = {
			success: true,
			showInDock: true,
			hideWhileRecording: false,
			launchAtLogin: false,
			launchAtLoginSupported: true,
			platform: "darwin",
		};
		window.electronAPI.getApplicationPreferences = async () => preferences;
		window.electronAPI.setApplicationPreferences = async (patch) => {
			preferences = { ...preferences, ...patch };
			return preferences;
		};
	});
}

async function openDashboard(page: Page) {
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	return page.getByRole("dialog", { name: "Projects dashboard", exact: true });
}

for (const fails of [false, true]) {
	test(`Hide HUD untoggle ${fails ? "keeps the previous state on failure" : "saves HUD inclusion in recordings"}`, async ({
		page,
	}) => {
		await installSettingsBridge(page);
		await page.addInitScript(
			({ fails }) => {
				window.electronAPI.getHudOverlayCaptureProtection = async () => ({
					success: true,
					enabled: localStorage.getItem("test-hide-hud") !== "false",
				});
				window.electronAPI.setHudOverlayCaptureProtection = async (enabled) => {
					document.documentElement.dataset.hideHudRequested = String(enabled);
					if (fails) return { success: false, enabled: true };
					localStorage.setItem("test-hide-hud", String(enabled));
					return { success: true, enabled };
				};
			},
			{ fails },
		);
		const openRecordingSettings = async () => {
			const home = await openDashboard(page);
			await home.getByRole("button", { name: "Recordly account" }).click();
			await page
				.getByRole("dialog", { name: "Account menu", exact: true })
				.getByRole("button", { name: "Settings", exact: true })
				.click();
			await home.getByRole("tab", { name: "Recording", exact: true }).click();
			return home.getByRole("switch", {
				name: "Hide recording controls from captured video",
				exact: true,
			});
		};
		const toggle = await openRecordingSettings();
		await expect(toggle).toBeChecked();
		await toggle.focus();
		await toggle.press("Space");
		await expect(page.locator("html")).toHaveAttribute("data-hide-hud-requested", "false");
		if (fails) {
			const failure = page
				.getByRole("tabpanel", { name: /^Recording settings/ })
				.getByRole("alert");
			await expect(failure).toContainText("Could not complete action");
			await expect(
				failure.getByText("Could not update capture protection"),
			).not.toBeVisible();
			await failure.getByRole("button", { name: "Technical details", exact: true }).click();
			await expect(failure.getByText("Could not update capture protection")).toBeVisible();
			await expect(toggle).toBeChecked();
		} else {
			await expect(toggle).not.toBeChecked();
			await page.reload();
			await expect(await openRecordingSettings()).not.toBeChecked();
		}
	});
}

for (const failure of ["recordings", "projects", "both"] as const) {
	test(`folder read errors explain retry and recover in place (${failure})`, async ({ page }) => {
		await installSettingsBridge(page);
		await installDesktopBridgeOverrides(
			page,
			(failure) => {
				let failing = true;
				let recordingsReads = 0;
				let projectsReads = 0;
				window.addEventListener("test-allow-folder-reads", () => {
					failing = false;
				});
				window.electronAPI.getRecordingsDirectory = async () => {
					document.documentElement.dataset.recordingsReads = String(++recordingsReads);
					if (failing && failure !== "projects")
						throw new Error("Recordings folder unavailable");
					return { success: true, path: "/restored/recordings" };
				};
				window.electronAPI.getProjectsDirectory = async () => {
					document.documentElement.dataset.projectsReads = String(++projectsReads);
					if (failing && failure !== "recordings") return { success: false };
					return { success: true, path: "/restored/projects" };
				};
				window.electronAPI.openRecordingsFolder = async () => {
					document.documentElement.dataset.openedFolder = "recordings";
					return { success: true };
				};
				window.electronAPI.openProjectsDirectory = async () => {
					document.documentElement.dataset.openedFolder = "projects";
					return { success: true };
				};
			},
			failure,
		);
		await page.goto("/?windowType=editor");
		await page.getByRole("button", { name: "Recordly account", exact: true }).click();
		await page
			.getByRole("dialog", { name: "Account menu", exact: true })
			.getByRole("button", { name: "Settings", exact: true })
			.click();
		const settings = page.getByRole("dialog", { name: "Settings", exact: true });
		await settings.getByRole("tab", { name: "General", exact: true }).click();
		const panel = settings.getByRole("tabpanel", { name: /^General settings/ });
		const folders = [
			{
				area: "recordings",
				title: "Recordings folder",
				error: "Recordings folder unavailable",
			},
			{
				area: "projects",
				title: "Projects folder",
				error: "Folder location is unavailable.",
			},
		] as const;
		for (const folder of folders) {
			const row = panel
				.locator(".settings-item")
				.filter({ has: page.getByText(folder.title, { exact: true }) });
			const open = row.getByRole("button", { name: "Open folder", exact: true });
			if (failure === folder.area || failure === "both") {
				await expect(row.getByText(folder.error, { exact: true })).toBeVisible();
				await expect(row.getByRole("alert")).toHaveText(folder.error);
				await expect(open).toBeDisabled();
			} else await expect(open).toBeEnabled();
		}
		const retry = panel.getByRole("button", { name: "Try again", exact: true });
		await expect(retry).toBeVisible();
		const counts = await page.locator("html").evaluate((node) => ({
			recordings: Number(node.dataset.recordingsReads),
			projects: Number(node.dataset.projectsReads),
		}));
		const url = page.url();
		await page.evaluate(() => window.dispatchEvent(new Event("test-allow-folder-reads")));
		await retry.click();
		await expect(retry).toHaveCount(0);
		for (const folder of folders) {
			const row = panel
				.locator(".settings-item")
				.filter({ has: page.getByText(folder.title, { exact: true }) });
			const open = row.getByRole("button", { name: "Open folder", exact: true });
			await expect(open).toBeEnabled();
			await expect(row.getByText(folder.error, { exact: true })).toHaveCount(0);
			await expect(row.getByText(`/restored/${folder.area}`, { exact: true })).toBeVisible();
			await open.click();
			await expect(page.locator("html")).toHaveAttribute("data-opened-folder", folder.area);
		}
		const updated = await page.locator("html").evaluate((node) => ({
			recordings: Number(node.dataset.recordingsReads),
			projects: Number(node.dataset.projectsReads),
		}));
		expect(updated.recordings).toBeGreaterThan(counts.recordings);
		expect(updated.projects).toBeGreaterThan(counts.projects);
		expect(page.url()).toBe(url);
	});
}

test("folder read errors override saved paths and announce later retry failures", async ({
	page,
}) => {
	await installSettingsBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		let phase = 0;
		window.addEventListener("test-folder-phase", (event) => {
			phase = (event as CustomEvent<number>).detail;
		});
		window.electronAPI.getRecordingsDirectory = async () => {
			if (phase === 1) throw new Error("Recordings folder read failed");
			return {
				success: true,
				path: phase === 0 ? "/initial/recordings" : "/restored/recordings",
			};
		};
		window.electronAPI.getProjectsDirectory = async () => {
			if (phase === 0) return { success: false };
			if (phase === 2) throw new Error("Projects folder read failed");
			return {
				success: true,
				path: phase === 1 ? "/initial/projects" : "/restored/projects",
			};
		};
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Recordly account", exact: true }).click();
	await page
		.getByRole("dialog", { name: "Account menu", exact: true })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	const settings = page.getByRole("dialog", { name: "Settings", exact: true });
	await settings.getByRole("tab", { name: "General", exact: true }).click();
	const panel = settings.getByRole("tabpanel", { name: /^General settings/ });
	const recordings = panel
		.locator(".settings-item")
		.filter({ has: page.getByText("Recordings folder", { exact: true }) });
	const projects = panel
		.locator(".settings-item")
		.filter({ has: page.getByText("Projects folder", { exact: true }) });
	const recordingsPath = recordings.locator(".settings-folder-path");
	const projectsPath = projects.locator(".settings-folder-path");
	const retry = panel.getByRole("button", { name: "Try again", exact: true });
	const setPhase = (phase: number) =>
		page.evaluate(
			(phase) =>
				window.dispatchEvent(new CustomEvent("test-folder-phase", { detail: phase })),
			phase,
		);
	await expect(recordingsPath).toHaveText("/initial/recordings");
	await expect(
		projects.getByText("Folder location is unavailable.", { exact: true }),
	).toBeVisible();
	await setPhase(1);
	await retry.click();
	await expect(projectsPath).toHaveText("/initial/projects");
	await expect(
		recordings.getByText("Recordings folder read failed", { exact: true }),
	).toBeVisible();
	await expect(recordings.getByRole("alert")).toHaveText("Recordings folder read failed");
	await expect(recordingsPath).not.toContainText("/initial/recordings");
	await expect(projects.getByRole("alert")).toHaveCount(0);
	await setPhase(2);
	await retry.click();
	await expect(recordingsPath).toHaveText("/restored/recordings");
	await expect(recordings.getByRole("alert")).toHaveCount(0);
	await expect(projects.getByText("Projects folder read failed", { exact: true })).toBeVisible();
	await expect(projects.getByRole("alert")).toHaveText("Projects folder read failed");
	await expect(projectsPath).not.toContainText("/initial/projects");
	await setPhase(3);
	await retry.click();
	await expect(recordingsPath).toHaveText("/restored/recordings");
	await expect(projectsPath).toHaveText("/restored/projects");
	await expect(panel.getByRole("alert")).toHaveCount(0);
	await expect(retry).toHaveCount(0);
});

for (const failure of ["result", "error", "non-error"] as const) {
	test(`HUD visibility read failure can retry in place (${failure})`, async ({ page }) => {
		await installSettingsBridge(page);
		await installDesktopBridgeOverrides(
			page,
			(failure) => {
				let failing = true;
				let reads = 0;
				window.addEventListener("test-allow-hud-read", () => {
					failing = false;
				});
				window.electronAPI.getHudOverlayCaptureProtection = async () => {
					document.documentElement.dataset.hudProtectionReads = String(++reads);
					if (failing) {
						if (failure === "error") throw new Error("HUD bridge unavailable");
						if (failure === "non-error")
							return Promise.reject("HUD bridge disconnected");
						return { success: false, enabled: true };
					}
					return { success: true, enabled: false };
				};
				window.electronAPI.setHudOverlayCaptureProtection = async (enabled) => {
					document.documentElement.dataset.hideHudRequested = String(enabled);
					return { success: true, enabled };
				};
			},
			failure,
		);
		const home = await openDashboard(page);
		await home.getByRole("button", { name: "Recordly account" }).click();
		await page
			.getByRole("dialog", { name: "Account menu", exact: true })
			.getByRole("button", { name: "Settings", exact: true })
			.click();
		await home.getByRole("tab", { name: "Recording", exact: true }).click();
		const panel = home.getByRole("tabpanel", { name: /^Recording settings/ });
		const retry = panel.getByRole("button", { name: "Try again", exact: true });
		await expect(panel.getByRole("alert")).toBeVisible();
		await expect(retry).toBeVisible();
		const failureText =
			failure === "result"
				? "Could not update capture protection"
				: failure === "error"
					? "HUD bridge unavailable"
					: "HUD bridge disconnected";
		await panel.getByRole("button", { name: "Technical details", exact: true }).click();
		await expect(panel.getByText(failureText, { exact: true })).toBeVisible();
		await expect(panel.getByText(`Error: ${failureText}`, { exact: true })).toHaveCount(0);
		const reads = Number(await page.locator("html").getAttribute("data-hud-protection-reads"));
		const url = page.url();
		await page.evaluate(() => window.dispatchEvent(new Event("test-allow-hud-read")));
		await retry.click();
		const toggle = panel.getByRole("switch", {
			name: "Hide recording controls from captured video",
			exact: true,
		});
		await expect(toggle).toBeEnabled();
		await expect(toggle).not.toBeChecked();
		await expect(panel.getByRole("alert")).toHaveCount(0);
		await expect(retry).toHaveCount(0);
		await expect
			.poll(async () =>
				Number(await page.locator("html").getAttribute("data-hud-protection-reads")),
			)
			.toBeGreaterThan(reads);
		await expect(page.locator("html")).not.toHaveAttribute("data-hide-hud-requested");
		expect(page.url()).toBe(url);
	});
}

test("Settings uses compact themes and keyboard tabs, and persists appearance", async ({
	page,
}) => {
	await installSettingsBridge(page);
	const home = await openDashboard(page);
	await home.getByRole("button", { name: "Recordly account" }).click();
	await page
		.getByRole("dialog", { name: "Account menu", exact: true })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	const sections = home.getByRole("tablist", { name: "Settings sections" });
	await expect(sections).toBeVisible();
	await sections.getByRole("tab", { name: "General", exact: true }).click();
	const appearance = home.getByRole("radiogroup", { name: "Appearance" });
	await expect(appearance.getByRole("radio")).toHaveCount(3);
	await appearance.getByText("Light", { exact: true }).click();
	await expect(appearance.getByRole("radio", { name: "Light", exact: true })).toBeChecked();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
	await sections.getByRole("tab", { name: "General", exact: true }).focus();
	await page.keyboard.press("ArrowDown");
	await expect(sections.getByRole("tab", { name: "Recording", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(home.getByRole("tabpanel", { name: /^Recording settings/ })).toBeVisible();
	await sections.getByRole("tab", { name: "General", exact: true }).click();
	await page.screenshot({
		path: "test-results/settings-theme-previews.png",
		animations: "disabled",
	});
	await page.reload();
	await page.getByRole("button", { name: "Home", exact: true }).click();
	await home.getByRole("button", { name: "Recordly account" }).click();
	await page
		.getByRole("dialog", { name: "Account menu", exact: true })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	await home.getByRole("tab", { name: "General", exact: true }).click();
	await expect(home.getByRole("radio", { name: "Light", exact: true })).toBeChecked();
});

test("library header account panel edits profile and opens Settings", async ({ page }) => {
	await installSettingsBridge(page);
	const home = await openDashboard(page);
	const trigger = home.getByRole("button", { name: "Recordly account" });
	await trigger.click();
	const menu = page.getByRole("dialog", { name: "Account menu", exact: true });
	await expect(menu.getByText("Test User", { exact: true })).toBeVisible();
	await expect(menu.getByText("Your account", { exact: true })).toBeVisible();
	const menuBounds = (await menu.boundingBox())!;
	const triggerBounds = (await trigger.boundingBox())!;
	expect(menuBounds.y).toBeGreaterThanOrEqual(triggerBounds.y + triggerBounds.height);
	await expect(menu).toBeInViewport();
	await page.screenshot({
		path: "test-results/sidebar-account-menu.png",
		animations: "disabled",
	});
	await page.keyboard.press("Escape");
	await expect(menu).not.toBeVisible();
	await expect(trigger).toBeFocused();
	await trigger.click();
	await menu.getByRole("button", { name: "Manage account" }).click();
	const account = page.getByRole("dialog", { name: "Account settings", exact: true });
	await expect(account.getByRole("textbox", { name: /^Display name\*?$/ })).toHaveValue(
		"Test User",
	);
	await account.getByRole("textbox", { name: /^Display name\*?$/ }).fill("Jordan Chen");
	await account.getByRole("button", { name: "Save profile" }).click();
	await expect(
		account.getByRole("status").filter({ hasText: /^Profile saved\.$/ }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(account).not.toBeVisible();
	await expect(trigger.getByLabel("Jordan Chen", { exact: true })).toBeVisible();
	await trigger.click();
	await expect(menu.getByText("Jordan Chen", { exact: true })).toBeVisible();
	await menu.getByRole("button", { name: "Settings", exact: true }).click();
	await expect(home.getByRole("tablist", { name: "Settings sections" })).toBeVisible();
});

productionTest("account logout clears the session", async ({ page }) => {
	await installSettingsBridge(page);
	const home = await openDashboard(page);
	await home.getByRole("button", { name: "Recordly account" }).click();
	const menu = page.getByRole("dialog", { name: "Account menu", exact: true });
	const logout = page.waitForRequest((request) => request.url().includes("/auth/v1/logout"));
	await menu.getByRole("button", { name: "Log out" }).click();
	await logout;
	await expect(
		page.getByRole("dialog", { name: "Sign in to Recordly", exact: true }),
	).toBeVisible();
	await expect(menu).not.toBeVisible();
});

test("editor profile opens shared Settings in a popup and preserves the editor", async ({
	page,
}) => {
	await installSettingsBridge(page);
	await page.goto("/?windowType=editor");
	const tools = page.getByRole("navigation", { name: "Editor tools", exact: true });
	await expect(tools.getByRole("radio", { name: "Settings", exact: true })).toHaveCount(0);
	await tools.getByRole("radio", { name: "Cursor", exact: true }).click();
	const video = page.locator('video[aria-hidden="true"]');
	await expect(video).toHaveCount(1);
	const originalVideo = (await video.elementHandle())!;
	const trigger = page.getByRole("button", { name: "Recordly account", exact: true });
	await trigger.hover();
	const triggerBounds = (await trigger.boundingBox())!;
	expect(triggerBounds.width).toBe(triggerBounds.height);
	await trigger.screenshot({ path: "test-results/editor-account-highlight.png" });
	await trigger.click();
	const menu = page.getByRole("dialog", { name: "Account menu", exact: true });
	await expect(menu.getByText("Test User", { exact: true })).toBeVisible();
	await expect(
		page.getByRole("dialog", { name: "Sign in to Recordly", exact: true }),
	).toHaveCount(0);
	await page.screenshot({ path: "test-results/editor-account-menu.png", animations: "disabled" });
	await page.keyboard.press("Escape");
	await expect(trigger).toBeFocused();
	await trigger.click();
	await menu.getByRole("button", { name: "Manage account" }).click();
	const profile = page.getByRole("dialog", { name: "Account settings", exact: true });
	await expect(profile.getByRole("textbox", { name: /^Display name\*?$/ })).toHaveValue(
		"Test User",
	);
	await page.keyboard.press("Escape");
	await trigger.click();
	await menu.getByRole("button", { name: "Settings", exact: true }).click();
	const settings = page.getByRole("dialog", { name: "Settings", exact: true });
	const home = page.getByRole("dialog", { name: "Projects dashboard", exact: true });
	await expect(home).not.toBeVisible();
	await expect(settings.getByRole("tablist", { name: "Settings sections" })).toBeVisible();
	await expect(settings.getByRole("tab", { name: "General", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	const bounds = (await settings.boundingBox())!;
	const viewport = page.viewportSize()!;
	expect(bounds.x + bounds.width / 2).toBeCloseTo(viewport.width / 2, 0);
	expect(bounds.y + bounds.height / 2).toBeCloseTo(viewport.height / 2, 0);
	await page.screenshot({
		path: "test-results/editor-settings-popup.png",
		animations: "disabled",
	});
	await page.setViewportSize({ width: 420, height: 800 });
	const narrowBounds = (await settings.boundingBox())!;
	expect(narrowBounds.x).toBeGreaterThanOrEqual(0);
	expect(narrowBounds.x + narrowBounds.width).toBeLessThanOrEqual(420);
	await page.screenshot({
		path: "test-results/editor-settings-popup-narrow.png",
		animations: "disabled",
	});
	await page.setViewportSize(viewport);
	await page.keyboard.press("Escape");
	await expect(settings).not.toBeVisible();
	await expect(trigger).toBeFocused();
	await expect(tools.getByRole("radio", { name: "Cursor", exact: true })).toHaveAttribute(
		"aria-checked",
		"true",
	);
	expect(await originalVideo.evaluate((node) => node.isConnected)).toBe(true);
	await page.getByRole("button", { name: "Home", exact: true }).click();
	await expect(home.getByRole("textbox", { name: "Search projects" })).toBeVisible();
});

test("account popup contains feedback and settings, and editor controls follow the theme", async ({
	page,
}) => {
	await installSettingsBridge(page);
	await page.goto("/?windowType=editor");
	const header = page.locator("header.editor-header");
	const upgrade = header.getByRole("button", { name: "Get Cloud", exact: true });
	await expect(upgrade).toBeVisible();
	const headerFeedback = header.getByRole("button", { name: "Feedback", exact: true });
	await expect(headerFeedback).toBeVisible();
	const undoBounds = await header
		.getByRole("button", { name: "Undo", exact: true })
		.boundingBox();
	const feedbackBounds = await headerFeedback.boundingBox();
	const upgradeBounds = await upgrade.boundingBox();
	const redoBounds = await header
		.getByRole("button", { name: "Redo", exact: true })
		.boundingBox();
	expect(upgradeBounds!.x + upgradeBounds!.width).toBeLessThan(undoBounds!.x);
	expect(feedbackBounds!.x).toBeGreaterThan(redoBounds!.x + redoBounds!.width);
	const feedbackFontSize = await headerFeedback.evaluate(
		(element) => getComputedStyle(element).fontSize,
	);
	expect(await upgrade.evaluate((element) => getComputedStyle(element).fontSize)).toBe(
		feedbackFontSize,
	);
	await expect(upgrade.locator(".plus-badge")).toHaveCount(0);
	await headerFeedback.click();
	await expect(page.getByRole("dialog", { name: "Send feedback", exact: true })).toBeVisible();
	await page.keyboard.press("Escape");
	const clips = header.getByRole("button", { name: "Clips", exact: true });
	await clips.click();
	await expect(clips).toHaveAttribute("aria-expanded", "true");
	await expect(page.getByRole("region", { name: "Clips library" })).toBeVisible();
	await clips.click();
	await expect(clips).toHaveAttribute("aria-expanded", "false");
	await page.getByRole("button", { name: "Recordly account", exact: true }).click();
	const menu = page.getByRole("dialog", { name: "Account menu", exact: true });
	await expect(menu.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
	await menu.getByRole("button", { name: "Feedback", exact: true }).click();
	await expect(menu).not.toBeVisible();
	const feedback = page.getByRole("dialog", { name: "Send feedback", exact: true });
	await expect(feedback).toBeVisible();
	await expect(
		feedback.getByText("Relevant diagnostic logs will be attached.", { exact: true }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	for (const theme of ["light", "dark"]) {
		await page.getByRole("button", { name: "Recordly account", exact: true }).click();
		await menu.getByRole("button", { name: "Settings", exact: true }).click();
		const settings = page.getByRole("dialog", { name: "Settings", exact: true });
		await settings.getByRole("tab", { name: "General", exact: true }).click();
		await settings
			.getByRole("radiogroup", { name: "Appearance" })
			.getByText(theme === "light" ? "Light" : "Dark", { exact: true })
			.click();
		await page.keyboard.press("Escape");
		const colors = await upgrade.evaluate((element) => {
			const style = getComputedStyle(element);
			return { background: style.backgroundColor, color: style.color };
		});
		expect(colors.background).not.toBe(colors.color);
		await page.screenshot({
			path: `test-results/editor-controls-${theme}.png`,
			animations: "disabled",
		});
	}
});

for (const viewport of [
	{ width: 1440, height: 1000 },
	{ width: 420, height: 800 },
]) {
	test(`settings keeps its frame stable at ${viewport.width}px while switching sections and loading permissions`, async ({
		page,
	}) => {
		await page.setViewportSize(viewport);
		await installSettingsBridge(page);
		await installDesktopBridgeOverrides(page, () => {
			window.electronAPI.getScreenRecordingPermissionStatus = async () => {
				await new Promise((resolve) => setTimeout(resolve, 600));
				return { success: true, status: "granted" };
			};
		});
		await page.goto("/?windowType=editor");
		await page.getByRole("button", { name: "Recordly account", exact: true }).click();
		await page
			.getByRole("dialog", { name: "Account menu", exact: true })
			.getByRole("button", { name: "Settings", exact: true })
			.click();
		const settings = page.getByRole("dialog", { name: "Settings", exact: true });
		await expect(settings.getByRole("tab", { name: "General", exact: true })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		// Let the opening animation settle; measure every frame during subsequent swaps.
		await expect(settings).not.toHaveAttribute("data-entering");
		await settings.screenshot({
			path: "test-results/settings-stable-frame.png",
			animations: "disabled",
		});
		const initial = (await settings.boundingBox())!;
		for (const name of ["Recording", "Account", "Motion", "General"]) {
			const frames = settings.evaluate(
				(element) =>
					new Promise<{ x: number; y: number; width: number; height: number }[]>(
						(resolve) => {
							const samples: {
								x: number;
								y: number;
								width: number;
								height: number;
							}[] = [];
							const start = performance.now();
							const sample = () => {
								const { x, y, width, height } = element.getBoundingClientRect();
								samples.push({ x, y, width, height });
								if (performance.now() - start < 850) requestAnimationFrame(sample);
								else resolve(samples);
							};
							requestAnimationFrame(sample);
						},
					),
			);
			await settings.getByRole("tab", { name, exact: true }).click();
			for (const frame of await frames) {
				for (const axis of ["x", "y", "width", "height"] as const)
					expect(Math.abs(frame[axis] - initial[axis]), `${name}: ${axis}`).toBeLessThan(
						1,
					);
			}
		}
	});
}

test("settings retains account drafts, groups preferences, and limits developer tools", async ({
	page,
}) => {
	await installSettingsBridge(page);
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Recordly account", exact: true }).click();
	await page
		.getByRole("dialog", { name: "Account menu", exact: true })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	const settings = page.getByRole("dialog", { name: "Settings", exact: true });
	await expect(settings.getByRole("button", { name: "Show onboarding" })).toHaveCount(0);
	await settings.getByRole("tab", { name: "General", exact: true }).click();
	await settings
		.getByRole("radiogroup", { name: "Appearance" })
		.getByText("Dark", { exact: true })
		.click();
	await settings.getByRole("tab", { name: "Account", exact: true }).click();
	const name = settings.getByRole("textbox", { name: /^Display name\*?$/ });
	await name.fill("Unsaved draft");
	const originalInput = (await name.elementHandle())!;
	await settings.getByRole("tab", { name: "Recording", exact: true }).click();
	await expect(settings.getByText("Allowed", { exact: true })).toHaveCount(2);
	await settings.screenshot({
		path: "test-results/settings-permissions.png",
		animations: "disabled",
	});
	await settings.getByRole("tab", { name: "Account", exact: true }).click();
	await expect(name).toHaveValue("Unsaved draft");
	expect(await originalInput.evaluate((element) => element.isConnected)).toBe(true);
	await settings.getByRole("tab", { name: "Recording", exact: true }).click();
	await expect(
		settings.getByRole("switch", { name: "Automatically add zooms", exact: true }),
	).toHaveCount(0);
	await expect(settings.getByText("Recordings folder", { exact: true })).not.toBeVisible();
	await settings.getByRole("tab", { name: "General", exact: true }).click();
	await expect(settings.getByText("Recordings folder", { exact: true })).toBeVisible();
	await expect(settings.getByText("Projects folder", { exact: true })).toBeVisible();
	await expect(settings.getByRole("button", { name: "Open file", exact: true })).toHaveCount(0);
	await settings.getByRole("tab", { name: "General", exact: true }).click();
	await expect(settings.getByRole("switch", { name: "Experimental updates" })).toBeVisible();
	await expect(settings.getByRole("button", { name: "Preview", exact: true })).toHaveCount(0);
	if (process.env.RECORDLY_TEST_PRODUCTION === "1") {
		await expect(settings.getByRole("tab", { name: "Dev", exact: true })).toHaveCount(0);
		await expect(settings.getByRole("button", { name: "Show onboarding" })).toHaveCount(0);
		await expect(settings.getByText("Camera Debug Tuning", { exact: true })).toHaveCount(0);
	} else {
		await settings.getByRole("tab", { name: "Dev", exact: true }).click();
		await expect(settings.getByRole("button", { name: "Show onboarding" })).toBeVisible();
		await expect(settings.getByText("Camera Debug Tuning", { exact: true })).toBeVisible();
		await expect(settings.getByRole("button", { name: "Preview", exact: true })).toBeVisible();
	}
	await page.setViewportSize({ width: 420, height: 800 });
	await settings.getByRole("tab", { name: "Recording", exact: true }).click();
	await settings.screenshot({
		path: "test-results/settings-permissions-narrow.png",
		animations: "disabled",
	});
	const panel = settings.getByRole("tabpanel");
	expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
		true,
	);
});

test("editor rail labels appear promptly above the inspector on hover and keyboard focus", async ({
	page,
}) => {
	await installSettingsBridge(page);
	await page.goto("/?windowType=editor");
	const rail = page.getByRole("navigation", { name: "Editor tools", exact: true });
	for (const label of ["Scene", "Cursor", "Webcam", "Captions"]) {
		const control = rail.getByRole("radio", { name: label, exact: true });
		await control.hover();
		const tooltip = page.getByRole("tooltip", { name: label, exact: true });
		await expect(tooltip).toBeVisible({ timeout: 1000 });
		await expect
			.poll(() =>
				tooltip.evaluate((node) => {
					const rect = node.getBoundingClientRect();
					const top = document.elementFromPoint(
						rect.x + rect.width / 2,
						rect.y + rect.height / 2,
					);
					return top === node || node.contains(top);
				}),
			)
			.toBe(true);
		if (label === "Scene")
			await page.screenshot({ path: "test-results/editor-rail-tooltip.png" });
		await page.mouse.move(700, 50);
		await expect(tooltip).toBeHidden();
	}
	const scene = rail.getByRole("radio", { name: "Scene", exact: true });
	await page.keyboard.press("Tab");
	await scene.focus();
	await expect(page.getByRole("tooltip", { name: "Scene", exact: true })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("tooltip")).toBeHidden();
	await page.keyboard.press("ArrowDown");
	await expect(rail.getByRole("radio", { name: "Cursor", exact: true })).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(rail.getByRole("radio", { name: "Cursor", exact: true })).toBeChecked();
	const account = page
		.locator(".app-frame-header")
		.getByRole("button", { name: "Recordly account", exact: true });
	await account.click();
	await expect(page.getByRole("dialog", { name: "Account menu", exact: true })).toBeVisible();
	await expect(page.getByRole("tooltip")).toBeHidden();
});
