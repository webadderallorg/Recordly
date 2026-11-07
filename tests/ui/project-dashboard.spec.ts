import fs from "node:fs/promises";
import path from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { hasFreshProjectThumbnail } from "../../electron/ipc/project/thumbnailFreshness";
import { encodeComposedThumbnail } from "../../electron/ipc/project/composedThumbnail";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

// These tests exercise the local project library, with healthy unrelated services.
test.beforeEach(async ({ page }) => {
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.listRecordings = async () => ({ success: true, value: [] });
		window.electronAPI.onCloudShareProgress = () => () => undefined;
		window.electronAPI.cloudShareManage = async () => ({
			success: true,
			videos: [],
			usage: {
				recordings: 0,
				recordingLimit: 5,
				storageBytes: 0,
				storageLimitBytes: 1e11,
				maxRecordingBytes: 1e9,
			},
		});
		window.electronAPI.setHasUnsavedChanges = (dirty) => {
			document.documentElement.dataset.projectDirty = String(dirty);
		};
	});
});
async function openDashboardSettings(page: Page, home: Locator) {
	await home.getByRole("button", { name: "Recordly account", exact: true }).click();
	await page
		.getByRole("dialog", { name: "Account menu", exact: true })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	await expect(page.getByRole("dialog", { name: "Account menu", exact: true })).not.toBeVisible();
}
async function waitForInitialProject(page: Page) {
	await expect(page.locator("html")).toHaveAttribute("data-project-creates", "1");
	await expect
		.poll(() =>
			page
				.locator("video")
				.first()
				.evaluate((video: HTMLVideoElement) => video.readyState >= 2),
		)
		.toBe(true);
	await expect(page.locator("html")).toHaveAttribute("data-project-dirty", "false");
}

test("Home opens with a wireframe while saving and returns to the main library", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	await waitForInitialProject(page);
	await page.evaluate(() => {
		const save = window.electronAPI.saveProjectFile;
		window.electronAPI.saveProjectFile = async (...args) => {
			if (args[3])
				await new Promise<void>((resolve) => {
					window.addEventListener("test-release-save", () => resolve(), { once: true });
					document.documentElement.dataset.savePending = "true";
				});
			return save(...args);
		};
	});
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const home = page.getByRole("dialog", { name: "Projects dashboard" });
	await expect(home).toBeVisible();
	await expect(home.getByLabel("Loading projects")).toBeVisible();
	await expect(page.locator("html")).toHaveAttribute("data-save-pending", "true");
	await page.screenshot({ path: "test-results/home-loading.png", animations: "disabled" });
	await page.evaluate(() => window.dispatchEvent(new Event("test-release-save")));
	await expect(home.getByLabel("Loading projects")).toHaveCount(0);
	await openDashboardSettings(page, home);
	await expect(home.getByRole("region", { name: "Dashboard settings" })).toBeVisible();
	await home.getByRole("button", { name: "Resume Untitled Project", exact: true }).click();
	await expect(home).not.toBeVisible();
	await page.evaluate(() => {
		delete document.documentElement.dataset.savePending;
	});
	await page.getByRole("button", { name: "Home", exact: true }).click();
	await expect(home.getByRole("textbox", { name: "Search projects" })).toBeVisible();
	await expect(page.locator("html")).toHaveAttribute("data-save-pending", "true");
	await page.evaluate(() => window.dispatchEvent(new Event("test-release-save")));
	await expect(home.getByLabel("Loading projects")).toHaveCount(0);
});

test("home dashboard searches, sorts, opens projects and returns to the editor", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		let entries = [
			{
				path: "/projects/launch.recordly",
				name: "Launch video",
				updatedAt: 1758000000000,
				thumbnailPath: null,
				isCurrent: true,
				isInProjectsDirectory: true,
			},
			{
				path: "/projects/demo.recordly",
				name: "App walkthrough",
				updatedAt: 1759000000000,
				thumbnailPath: `${location.origin}/tests/ui/fixtures/recording-thumbnail.jpg`,
				isCurrent: false,
				isInProjectsDirectory: true,
			},
			{
				path: "/projects/tutorial.recordly",
				name: "Getting started",
				updatedAt: 1757000000000,
				thumbnailPath: null,
				isCurrent: false,
				isInProjectsDirectory: true,
			},
		];
		window.electronAPI.listProjectFiles = async () => ({
			success: true,
			projects: [],
			entries,
		});
		window.electronAPI.trashProjectFiles = async (paths) => {
			entries = entries.filter((entry) => !paths.includes(entry.path));
			return { success: true, deleted: paths, errors: [] };
		};
		window.electronAPI.openProjectFileAtPath = async (path) => {
			document.documentElement.dataset.openedProject = path;
			return { success: false, canceled: true };
		};
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const home = page.getByRole("dialog", { name: "Projects dashboard", exact: true });
	await expect(home).toBeVisible();
	const cards = home.getByRole("list", { name: "Your projects" }).locator("li > button");
	await expect(cards).toHaveCount(3);
	await expect(cards.first()).toHaveAccessibleName("App walkthrough");
	await home.getByRole("button", { name: "Sort projects" }).click();
	await page.getByRole("menuitem", { name: "Name", exact: true }).click();
	await expect(cards.nth(1)).toHaveAccessibleName("Getting started");
	const normalCardWidth = (await cards.first().boundingBox())!.width;
	await home.getByRole("textbox", { name: "Search projects" }).fill("launch");
	await expect(cards).toHaveCount(1);
	expect(Math.abs((await cards.first().boundingBox())!.width - normalCardWidth)).toBeLessThan(1);
	await home.getByRole("textbox", { name: "Search projects" }).fill("missing");
	await expect(home.getByText("No matching projects")).toBeVisible();
	await home.getByRole("button", { name: "Clear filters" }).click();
	await home.getByRole("button", { name: "App walkthrough", exact: true }).click();
	await expect(page.getByRole("dialog", { name: "Project details" })).toHaveCount(0);
	await expect(page.locator("html")).toHaveAttribute(
		"data-opened-project",
		"/projects/demo.recordly",
	);
	await expect(home).toBeVisible();
	await home.getByRole("button", { name: "New folder", exact: true }).click();
	await expect(page.getByRole("dialog", { name: "New folder", exact: true })).toHaveCount(0);
	await home.getByRole("button", { name: "Untitled folder", exact: true }).dblclick();
	await home.getByRole("textbox", { name: "Folder name" }).fill("Tutorials");
	await page.keyboard.press("Enter");
	await home.getByRole("button", { name: "Change color for Tutorials", exact: true }).click();
	await page.getByRole("textbox", { name: "Hex color", exact: true }).fill("#123abc");
	await page.keyboard.press("Tab");
	await page.getByRole("button", { name: "Save custom color", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Remove custom color", exact: true }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await home.getByRole("button", { name: "Home", exact: true }).click();
	await expect(
		home.getByRole("list", { name: "Your projects" }).locator('[aria-label="Test User"]'),
	).toHaveCount(0);

	await home.getByRole("button", { name: "Options for App walkthrough", exact: true }).click();
	await expect(page.getByRole("menuitem", { name: "No folder", exact: true })).toHaveCount(0);
	await page.keyboard.press("Escape");
	await home.getByRole("button", { name: "Add folder to App walkthrough", exact: true }).click();
	await page.getByRole("menuitem", { name: "Tutorials", exact: true }).click();
	await expect(
		home.getByRole("button", { name: "Remove App walkthrough from Tutorials", exact: true }),
	).toContainText("Tutorials");
	await home.getByRole("button", { name: "Tutorials", exact: true }).click();
	await expect(cards).toHaveCount(1);
	await expect(cards.first()).toHaveAccessibleName("App walkthrough");
	await home.getByRole("button", { name: "Home", exact: true }).click();
	await home.getByRole("button", { name: "Last 7 days", exact: true }).click();
	await expect(cards).toHaveCount(0);
	await home.getByRole("button", { name: "All", exact: true }).click();
	await expect(cards).toHaveCount(3);
	await openDashboardSettings(page, home);
	await expect(home.getByRole("region", { name: "Dashboard settings" })).toBeVisible();
	await home.getByRole("button", { name: "Home", exact: true }).click();
	await home
		.getByRole("complementary", { name: "Library navigation" })
		.getByRole("button", { name: "Record new", exact: true })
		.click();
	await expect(page.locator("html")).toHaveAttribute("data-hud-opened", "true");
	await home.getByRole("button", { name: "Select projects to delete" }).click();
	await cards.first().click();
	await expect(cards.first()).toHaveAttribute("aria-pressed", "true");
	await home.getByRole("button", { name: "Review deletion…", exact: true }).click();
	await page.getByRole("dialog", { name: "Review deletion", exact: true }).getByRole("button", { name: "Move to Trash", exact: true }).click();
	await expect(page.getByRole("dialog", { name: "Review deletion", exact: true })).not.toBeVisible();
	await expect(cards).toHaveCount(2);
	await page.screenshot({ path: "test-results/project-dashboard.png", animations: "disabled" });
	await page.evaluate(() => document.documentElement.classList.add("dark"));
	await page.screenshot({
		path: "test-results/project-dashboard-dark.png",
		animations: "disabled",
	});
	await page.evaluate(() => document.documentElement.classList.remove("dark"));
	await page.setViewportSize({ width: 800, height: 800 });
	await expect(home.getByRole("button", { name: "Import", exact: true })).toBeInViewport();
	await page.screenshot({
		path: "test-results/project-dashboard-compact.png",
		animations: "disabled",
	});
	await home.getByRole("button", { name: "Launch video", exact: true }).click();
	await expect(home).not.toBeVisible();
	await expect(page.getByRole("button", { name: "Rename project" })).toBeVisible();
});

test("home dashboard explains an empty library", async ({ page }) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	await expect(page.getByText("No projects yet", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Record new", exact: true })).toHaveCount(1);
	await page.getByRole("button", { name: "Record your first video", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-hud-opened", "true");
	await page.evaluate(() => {
		delete document.documentElement.dataset.hudOpened;
	});
	await page
		.getByRole("complementary", { name: "Library navigation" })
		.getByRole("button", { name: "Record new", exact: true })
		.click();
	await expect(page.locator("html")).toHaveAttribute("data-hud-opened", "true");
	await page.screenshot({ path: "test-results/dashboard-empty.png", animations: "disabled" });
	await expect(
		page.getByRole("button", { name: "Resume Untitled Project", exact: true }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("button", { name: "Rename project" })).toBeVisible();
});

test("autosave creates one untitled project, stays idle without edits, and refreshes its preview on exit without a saved toast", async ({
	page,
}, testInfo) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		const save = window.electronAPI.saveProjectFile;
		window.electronAPI.saveProjectFile = async (...args) => {
			const result = await save(...args);
			if (args[3]) document.documentElement.dataset.savedThumbnail = args[3];
			return result;
		};
		window.electronAPI.listProjectFiles = async () => ({
			success: true,
			projects: [],
			entries: [
				{
					path: "/projects/preview.recordly",
					name: "Generated preview",
					updatedAt: 1,
					thumbnailPath: document.documentElement.dataset.savedThumbnail ?? null,
					isCurrent: true,
					isInProjectsDirectory: true,
				},
			],
		});
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator("html")).toHaveAttribute("data-project-creates", "1");
	await expect(page.getByRole("button", { name: "Rename project" })).toContainText(
		"Untitled Project",
	);
	await waitForInitialProject(page);
	// Observe more than two debounce periods: idle must not perform periodic saves.
	const before = await page.locator("html").getAttribute("data-project-saves");
	await page.waitForTimeout(1800);
	await expect(page.locator("html")).toHaveAttribute("data-project-creates", "1");
	expect(await page.locator("html").getAttribute("data-project-saves")).toBe(before);
	await page.getByRole("button", { name: "Home", exact: true }).click();
	await expect(page.getByRole("dialog", { name: "Projects dashboard" })).toBeVisible();
	await expect(page.locator("html")).toHaveAttribute(
		"data-saved-thumbnail",
		/^data:image\/png;base64,/,
	);
	const thumbnail = await page.locator("html").getAttribute("data-saved-thumbnail");
	const file = testInfo.outputPath("generated-preview.png");
	await fs.mkdir(path.dirname(file), { recursive: true });
	// Main stamps the composed marker when persisting renderer output.
	await fs.writeFile(file, encodeComposedThumbnail(thumbnail!));
	// Exercise the actual main-process acceptance check against its encoded file.
	expect(await hasFreshProjectThumbnail(file, 0)).toBe(true);
	const image = page
		.getByRole("button", { name: "Generated preview", exact: true })
		.locator("img");
	await expect(image).toBeVisible();
	await expect
		.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
		.toBe(640);
	await expect(page.getByText(/Project saved/)).toHaveCount(0);
});

test("deletion refreshes the grid and keeps unselected projects", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		let entries = ["Keep", "Delete"].map((name) => ({
			path: `/projects/${name}.recordly`,
			name,
			updatedAt: Date.now(),
			thumbnailPath: null,
			isCurrent: false,
			isInProjectsDirectory: true,
		}));
		window.electronAPI.listProjectFiles = async () => ({ success: true, entries });
		window.electronAPI.trashProjectFiles = async (paths) => {
			entries = entries.filter((e) => !paths.includes(e.path));
			return { success: true, deleted: paths, errors: [] };
		};
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const home = page.getByRole("dialog", { name: "Projects dashboard" });
	await home.getByRole("button", { name: "Select projects to delete" }).click();
	await home.getByRole("list").getByRole("button", { name: "Delete", exact: true }).click();
	await home
		.getByRole("button", { name: "Review deletion…", exact: true })
		.filter({ hasNot: page.locator("img") })
		.first()
		.click();
	await page.getByRole("dialog", { name: "Review deletion", exact: true }).getByRole("button", { name: "Move to Trash", exact: true }).click();
	await expect(page.getByRole("dialog", { name: "Review deletion", exact: true })).not.toBeVisible();
	await expect(
		home.getByRole("list").getByRole("button", { name: "Delete", exact: true }),
	).toHaveCount(0);
	await expect(home.getByRole("button", { name: "Keep", exact: true })).toBeVisible();
});

test("cards rename inline, preserve folder chips and use existing share links", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		let entry = {
			path: "/projects/demo.recordly",
			name: "Demo",
			updatedAt: Date.now(),
			thumbnailPath: null,
			isCurrent: false,
			isInProjectsDirectory: true,
		};
		localStorage.setItem(
			"recordly.project-folders.v1",
			JSON.stringify([{ id: "folder", name: "Work", color: "#123abc", paths: [entry.path] }]),
		);
		localStorage.setItem(
			"recordly.project-share-links.v1",
			JSON.stringify({
				[entry.path]: {
					url: "https://example.com/shared/demo",
					sharedAt: Date.now() + 1000,
				},
			}),
		);
		window.electronAPI.listProjectFiles = async () => ({ success: true, entries: [entry] });
		window.electronAPI.renameLibraryProject = async (_path, name) => {
			entry = { ...entry, path: `/projects/${name}.recordly`, name };
			return { success: true, path: entry.path };
		};
		window.electronAPI.openExternalUrl = async (url) => {
			document.documentElement.dataset.openedUrl = url;
			return { success: true };
		};
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const home = page.getByRole("dialog", { name: "Projects dashboard" });
	await expect(home.getByRole("button", { name: "Remove Demo from Work" })).toContainText("Work");
	await home.getByRole("button", { name: "Options for Demo" }).click();
	await page.getByRole("menuitem", { name: "View link", exact: true }).click();
	await expect(page.getByLabel("Share link", { exact: true })).toHaveValue(
		"https://example.com/shared/demo",
	);
	await page.keyboard.press("Escape");
	await home.getByRole("button", { name: "Options for Demo" }).click();
	await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
	const renameInput = home.getByRole("textbox", { name: "Project name" });
	await expect(renameInput).toBeFocused();
	expect(
		await renameInput.evaluate((input: HTMLInputElement) => [
			input.selectionStart,
			input.selectionEnd,
		]),
	).toEqual([0, 4]);
	await home.getByRole("textbox", { name: "Project name" }).fill("Renamed");
	await page.keyboard.press("Enter");
	await expect(home.getByRole("button", { name: "Renamed", exact: true })).toBeVisible();
	await expect(home.getByRole("button", { name: "Remove Renamed from Work" })).toContainText(
		"Work",
	);
	await home.getByRole("button", { name: "Options for Renamed" }).click();
	await expect(page.getByRole("menuitem", { name: "View link", exact: true })).toBeVisible();
});

test("dashboard supports creation sort, independent folders, shared settings and precise captions", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		localStorage.setItem(
			"recordly.project-folders.v1",
			JSON.stringify([
				{ id: "one", name: "Work", color: "#123abc", paths: ["/old.recordly"] },
				{ id: "two", name: "Personal", color: "#123abc", paths: [] },
			]),
		);
		window.electronAPI.listProjectFiles = async () => ({
			success: true,
			entries: [
				{
					path: "/old.recordly",
					name: "Old",
					updatedAt: 300,
					createdAt: 100,
					thumbnailPath: null,
					isCurrent: false,
					isInProjectsDirectory: true,
				},
				{
					path: "/new.recordly",
					name: "Newer",
					updatedAt: 200,
					createdAt: 200,
					thumbnailPath: null,
					isCurrent: false,
					isInProjectsDirectory: true,
				},
			],
		});
	});
	await page.goto("/?windowType=editor");
	await waitForInitialProject(page);
	await page.getByRole("button", { name: "Clips", exact: true }).click();
	await expect(page.getByRole("complementary", { name: "Clips" })).toBeVisible();
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const home = page.getByRole("dialog", { name: "Projects dashboard" });
	await expect(home.getByLabel("Announcements", { exact: true })).toHaveCount(0);
	await home.getByRole("button", { name: "Sort projects" }).click();
	await page.getByRole("menuitem", { name: "Last created", exact: true }).click();
	await expect(
		home.getByRole("list", { name: "Your projects" }).locator("li > button").first(),
	).toHaveAccessibleName("Newer");
	await home.getByRole("button", { name: "Add folder to Old" }).click();
	await page.getByRole("menuitem", { name: "Personal", exact: true }).click();
	await expect(home.getByRole("button", { name: "Remove Old from Work" })).toBeVisible();
	await expect(home.locator('[aria-label="1 more folders: Personal"]')).toBeVisible();
	const oldCard = home
		.getByRole("list", { name: "Your projects" })
		.locator("li")
		.filter({ has: page.getByRole("button", { name: "Old", exact: true }) });
	await oldCard.evaluate((card) => {
		card.style.width = "600px";
	});
	await expect(home.getByRole("button", { name: "Remove Old from Personal" })).toBeVisible();
	await expect(home.locator('[aria-label="1 more folders: Personal"]')).toHaveCount(0);
	const membership = await page.evaluate(() =>
		JSON.parse(localStorage.getItem("recordly.project-folders.v1") || "[]"),
	);
	expect(
		membership.every((folder: { paths: string[] }) => folder.paths.includes("/old.recordly")),
	).toBe(true);
	// Local cards intentionally show project captions without account avatars.
	await expect(
		home.getByRole("list", { name: "Your projects" }).locator('[aria-label="Test User"]'),
	).toHaveCount(0);
	await openDashboardSettings(page, home);
	await expect(home.getByRole("textbox", { name: "Search projects" })).toHaveCount(0);
	await expect(home.getByRole("button", { name: "Sort projects" })).toHaveCount(0);
	await expect(home.getByRole("tablist", { name: "Settings sections" })).toHaveCount(1);
	await expect(home.getByRole("switch", { name: "Connect Zooms" })).toHaveCount(0);
	await home.getByRole("tab", { name: "General", exact: true }).click();
	await expect(home.getByRole("switch", { name: "Experimental updates" })).toBeVisible();

	await home.getByRole("tab", { name: "Motion", exact: true }).click();
	await expect(home.getByRole("switch", { name: "Connect Zooms" })).toBeVisible();
	const motion = home.getByRole("tabpanel", { name: /^Motion settings/ });
	const description = "Smooth consecutive zoom regions into a continuous camera move.";
	await expect(motion.getByText(description, { exact: true })).not.toBeVisible();
	await motion.locator(".settings-row .settings-info").first().hover();
	await expect(page.getByRole("tooltip")).toHaveText(description);
	await page.keyboard.press("Escape");
	await page.screenshot({ path: "test-results/settings-motion.png", animations: "disabled" });
	await home.getByRole("tab", { name: "General", exact: true }).click();
	await expect(home.getByText("Recordings folder", { exact: true })).toBeVisible();
	await home.getByRole("button", { name: "Change folder" }).click();
	await expect(home.getByText("/new-recordings", { exact: true })).toBeVisible();
	await home.getByRole("tab", { name: "Recording", exact: true }).click();
	const capture = home.getByRole("switch", {
		name: "Hide recording controls from captured video",
		exact: true,
	});
	await capture.press("Space");
	await expect(page.locator("html")).toHaveAttribute("data-hide-hud", "true");
	await home.getByRole("tab", { name: "General", exact: true }).click();
	await expect(home.getByRole("button", { name: "Open folder", exact: true })).toHaveCount(2);
	await expect(home.getByText("/new-recordings", { exact: true })).toBeVisible();
	await home.getByRole("tab", { name: "General", exact: true }).click();
	await expect(home.getByRole("radio", { name: "Dark", exact: true })).toBeVisible();
	await page.screenshot({ path: "test-results/dashboard-settings.png", animations: "disabled" });
});

test("account menu opens the raw folder without a sidebar shortcut", async ({ page }) => {
	test.setTimeout(120000);
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.openRecordingsFolder = async () => {
			document.documentElement.dataset.rawFolderOpened = "true";
			return { success: true };
		};
	});
	await page.goto("/?windowType=editor");
	const scene = page.getByRole("radio", { name: "Scene", exact: true });
	const videos = page.getByRole("button", { name: "Clips", exact: true });
	await expect(scene).toBeChecked({ timeout: 30000 });
	await expect(scene.locator("svg")).toHaveAttribute("data-icon-style", "bold");
	await videos.click();
	await expect(videos).toHaveAttribute("aria-expanded", "true");
	await expect(videos.locator("svg")).toHaveAttribute("data-icon-style", "bold");
	await expect(scene.locator("svg")).toHaveAttribute("data-icon-style", "linear");
	await scene.click();
	await expect(scene).toBeChecked();
	await expect(videos).toHaveAttribute("aria-expanded", "false");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const home = page.getByRole("dialog", { name: "Projects dashboard" });
	const sidebar = home.getByRole("complementary", { name: "Library navigation" });
	await expect(sidebar.getByRole("button", { name: /Open raw/ })).toHaveCount(0);
	await expect(sidebar.getByRole("button", { name: "Original recordings", exact: true })).toHaveCount(0);
	await home.getByRole("button", { name: "Recordly account", exact: true }).click();
	const menu = page.getByRole("dialog", { name: "Account menu", exact: true });
	await expect(menu.getByRole("button", { name: "Open raw folder", exact: true })).toBeVisible();
	await menu.screenshot({ path: test.info().outputPath("raw-folder-menu.png"), animations: "disabled" });
	await menu.getByRole("button", { name: "Open raw folder", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-raw-folder-opened", "true");
	await expect(menu).not.toBeVisible();
	await expect(home.getByRole("heading", { name: "Your projects", exact: true })).toBeVisible();
	await expect(home.getByRole("textbox", { name: "Search original recordings" })).toHaveCount(0);
});

test("project hover plays a muted five-second preview and stops on exit", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.listProjectFiles = async () => ({
			success: true,
			projects: [],
			entries: [
				{
					path: "/projects/hover.recordly",
					name: "Hover preview",
					updatedAt: 1,
					thumbnailPath: null,
					isCurrent: false,
					isInProjectsDirectory: true,
				},
			],
		});
		window.electronAPI.getProjectPreview = async () => {
			document.documentElement.dataset.previewRequests = String(
				Number(document.documentElement.dataset.previewRequests || 0) + 1,
			);
			return {
				success: true,
				value: {
					videoUrl: `${location.origin}/tests/ui/fixtures/preview.mp4`,
					webcamUrl: null,
					project: {
						version: 1,
						videoPath: "/recordings/preview.mp4",
						editor: {
							clipRegions: [
								{ id: "clip", startMs: 0, endMs: 6000, sourceStartMs: 0, speed: 1 },
							],
						},
					},
				},
			};
		};
	});
	await page.goto("/?windowType=editor");
	await expect(page.getByRole("button", { name: "Open presets" })).toHaveCount(0);
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const card = page.getByRole("button", { name: "Hover preview", exact: true });
	await expect(card).toBeVisible({ timeout: 15000 });
	await expect(card.locator("[data-thumbnail-duration]")).toHaveText("0:06");
	await expect(page.locator("html")).toHaveAttribute("data-preview-requests", "1");
	const cardBounds = (await card.boundingBox())!;
	await card.hover();
	// The preview overlays the thumbnail without changing the library grid geometry.
	expect(Math.abs((await card.boundingBox())!.width - cardBounds.width)).toBeLessThan(1);
	const preview = page.locator("[data-project-hover-preview]");
	await expect(preview).toBeVisible();
	await expect(card.locator("[data-thumbnail-duration]")).toBeVisible();
	await expect
		.poll(() =>
			preview
				.locator("video")
				.first()
				.evaluate(
					(video: HTMLVideoElement) =>
						!video.paused && video.currentTime > 0 && video.muted,
				),
		)
		.toBe(true);
	const fill = await preview.evaluate((element) => {
		const card = element.getBoundingClientRect();
		const frame = element.firstElementChild!.getBoundingClientRect();
		return {
			card: card.toJSON(),
			frame: frame.toJSON(),
			covers:
				frame.left <= card.left + 1 &&
				frame.top <= card.top + 1 &&
				frame.right >= card.right - 1 &&
				frame.bottom >= card.bottom - 1,
		};
	});
	expect(fill, JSON.stringify(fill)).toMatchObject({ covers: true });
	expect(fill.frame.width / fill.frame.height).toBeCloseTo(16 / 9, 2);
	expect(fill.frame.height).toBeCloseTo(fill.card.height, 0);
	await expect(preview).toHaveCount(0, { timeout: 8000 });
	await page.mouse.move(0, 0);
	await card.hover();
	await expect(preview).toBeVisible();
	await page.mouse.move(0, 0);
	await expect(preview).toHaveCount(0);
});

test("Home opens normally without a current recording", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getCurrentVideoPath = async () => ({ success: false });
		localStorage.setItem("recordly.open-dashboard", String(Date.now()));
	});
	await page.goto("/?windowType=editor");
	const home = page.getByRole("dialog", { name: "Projects dashboard", exact: true });
	await expect(home).toBeVisible({ timeout: 30000 });
	await expect(home.getByRole("button", { name: /^Resume / })).toHaveCount(0);
	await expect(home.getByRole("textbox", { name: "Search projects" })).toBeVisible();
	await expect(page.getByText("No video to load.", { exact: false })).toHaveCount(0);
	await expect(page.getByRole("alert")).toHaveCount(0);
});

test("folder actions stay inside narrow project cards without clipping", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		const entries = Array.from({ length: 4 }, (_, index) => ({
			path: `/projects/card-${index}.recordly`,
			name: `Project ${index + 1}`,
			updatedAt: 1,
			thumbnailPath: null,
			isCurrent: false,
			isInProjectsDirectory: true,
		}));
		localStorage.setItem(
			"recordly.project-folders.v1",
			JSON.stringify([
				{
					id: "one",
					name: "A very long folder name",
					color: "#123abc",
					paths: entries.map((entry) => entry.path),
				},
				{
					id: "two",
					name: "Work",
					color: "#123abc",
					paths: entries.map((entry) => entry.path),
				},
			]),
		);
		window.electronAPI.listProjectFiles = async () => ({ success: true, entries });
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const home = page.getByRole("dialog", { name: "Projects dashboard" });
	const card = home.getByRole("list", { name: "Your projects" }).locator("li").first();
	const add = card.getByRole("button", { name: "Add folder to Project 1", exact: true });
	for (const width of [800, 1280, 1440]) {
		await page.setViewportSize({ width, height: 1000 });
		await card.hover();
		const folderFits = await card
			.getByRole("button", {
				name: "Remove Project 1 from A very long folder name",
				exact: true,
			})
			.evaluate((element) => {
				const chip = element.getBoundingClientRect();
				const group = element.parentElement!.getBoundingClientRect();
				return (
					chip.left >= group.left &&
					chip.right <= group.right + 1 &&
					element.scrollWidth <= element.clientWidth + 1
				);
			});
		expect(folderFits).toBe(true);
		const bounds = await add.evaluate((element) => {
			const button = element.getBoundingClientRect();
			const caption = element.closest("[data-project-caption]")!.getBoundingClientRect();
			const hit = document.elementFromPoint(button.right - 3, button.top + button.height / 2);
			return {
				inside: button.left >= caption.left && button.right <= caption.right + 1,
				fullWidth: element.scrollWidth <= element.clientWidth + 1,
				reachable: hit !== null && element.contains(hit),
			};
		});
		expect(bounds).toEqual({ inside: true, fullWidth: true, reachable: true });
	}
	await card.evaluate((element) => {
		element.style.width = "600px";
	});
	await expect(
		card.getByRole("button", { name: "Remove Project 1 from Work", exact: true }),
	).toBeVisible();
	await expect(card.locator('[aria-label="1 more folders: Work"]')).toHaveCount(0);
	await card.evaluate((element) => {
		element.style.width = "340px";
	});
	await expect(card.locator('[aria-label="1 more folders: Work"]')).toBeVisible();
	await add.click();
	await expect(page.getByRole("menuitem", { name: "Work", exact: true })).toBeVisible();
	await page.keyboard.press("Escape");
	await page.screenshot({ path: "test-results/folder-actions.png", animations: "disabled" });
});

test("sidebar cards, separate Import, and shortcut settings use the dashboard flow", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.saveShortcuts = async (value) => {
			document.documentElement.dataset.savedShortcuts = JSON.stringify(value);
			return { success: true };
		};
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const home = page.getByRole("dialog", { name: "Projects dashboard" });
	const sidebar = home.getByRole("complementary", { name: "Library navigation" });
	await expect(sidebar.getByRole("button", { name: "Import", exact: true })).toHaveCount(0);
	await expect(sidebar.getByRole("img", { name: "Placeholder banner" })).toHaveCount(0);
	const settingsButton = sidebar.getByRole("button", { name: "Settings", exact: true });
	await expect(settingsButton).toHaveCount(1);
	await expect(settingsButton).toBeVisible();
	const importButton = home.getByRole("button", { name: "Import", exact: true });
	const all = home.getByRole("button", { name: "All", exact: true });
	expect((await importButton.boundingBox())!.y - (await all.boundingBox())!.y).toBeLessThan(0);
	expect(await all.evaluate((element) => element.parentElement!.textContent)).not.toContain(
		"Import",
	);
	await openDashboardSettings(page, home);
	await home.getByRole("tab", { name: "Shortcuts", exact: true }).click();
	const shortcuts = home.getByRole("tabpanel", { name: /^Shortcuts settings/ });
	await expect(shortcuts).toBeVisible();
	const change = shortcuts.getByRole("button", { name: /^Change Add Zoom shortcut, currently / });
	await change.click();
	await expect(shortcuts.getByRole("button", { name: /^Add Zoom: / })).toHaveAccessibleName(
		/press.*key/i,
	);
	await page.keyboard.press("j");
	await expect(change).toHaveText("J");
	await expect(change).toHaveAccessibleName("Change Add Zoom shortcut, currently J");
	await shortcuts.getByRole("button", { name: "Save", exact: true }).scrollIntoViewIfNeeded();
	await page.screenshot({ path: "test-results/dashboard-shortcuts.png", animations: "disabled" });
	await shortcuts.getByRole("button", { name: "Save", exact: true }).click();
	await expect
		.poll(() => page.locator("html").getAttribute("data-saved-shortcuts"))
		.toContain('"addZoom":{"key":"j"}');
	await expect(shortcuts).toBeVisible();
	await home.getByRole("tab", { name: "General", exact: true }).click();
	await expect(shortcuts).not.toBeVisible();
	await home.getByRole("tab", { name: "Shortcuts", exact: true }).click();
	await expect(change).toHaveText("J");
	await expect(change).toHaveAccessibleName("Change Add Zoom shortcut, currently J");
	await page.setViewportSize({ width: 800, height: 600 });
	await shortcuts.getByRole("button", { name: "Save", exact: true }).scrollIntoViewIfNeeded();
	await expect(shortcuts.getByRole("button", { name: "Save", exact: true })).toBeInViewport();
	const shortcutsHeading = shortcuts.getByRole("heading", { level: 2 });
	await expect(shortcutsHeading).toContainText("Shortcuts");
	await shortcutsHeading.scrollIntoViewIfNeeded();
	await expect(shortcutsHeading).toBeInViewport();
	await page.screenshot({
		path: "test-results/dashboard-shortcuts-compact.png",
		animations: "disabled",
	});
});

test("empty filtered libraries do not prompt for a first recording", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getCurrentVideoPath = async () => ({ success: false });
	});
	await page.goto("/?windowType=editor");
	const home = page.getByRole("dialog", { name: "Projects dashboard" });
	const first = home.getByRole("button", { name: "Record your first video", exact: true });
	await expect(first).toBeVisible();
	await home.getByRole("button", { name: "Last 7 days", exact: true }).click();
	await expect(home.getByText("No matching projects", { exact: true })).toBeVisible();
	await expect(first).toHaveCount(0);
	await home.getByRole("button", { name: "All", exact: true }).click();
	await expect(first).toBeVisible();
	await home.getByRole("button", { name: "New folder", exact: true }).click();
	await home.getByRole("button", { name: "Untitled folder", exact: true }).click();
	await expect(home.getByText("This folder is empty", { exact: true })).toBeVisible();
	await expect(first).toHaveCount(0);
});

for (const stale of [false, true]) {
	test(`saved project links open the finished share view${stale ? " with Regenerate for a newer project" : " without uploading again"}`, async ({
		page,
	}) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		await installDesktopBridge(page);
		await installDesktopBridgeOverrides(
			page,
			({ stale }) => {
				const updatedAt = Date.now();
				localStorage.setItem(
					"recordly.project-share-links.v1",
					JSON.stringify({
						"/projects/shared.recordly": {
							url: "https://example.test/s/existing",
							revision: "saved",
							sharedAt: updatedAt + (stale ? -1000 : 1000),
						},
					}),
				);
				window.electronAPI.listProjectFiles = async () => ({
					success: true,
					projects: [],
					entries: [
						{
							path: "/projects/shared.recordly",
							name: "Shared demo",
							updatedAt,
							thumbnailPath: null,
							isCurrent: false,
							isInProjectsDirectory: true,
						},
					],
				});
				window.electronAPI.onCloudShareProgress = () => () => undefined;
				window.electronAPI.cloudShareManage = async () => ({ success: true, videos: [] });
				window.electronAPI.writeClipboardText = async (text) => {
					document.documentElement.dataset.copiedShare = text;
					return { success: true };
				};
			},
			{ stale },
		);
		await page.goto("/?windowType=editor");
		await expect(page.locator("html")).toHaveAttribute("data-project-creates", "1", {
			timeout: 20000,
		});
		await page.getByRole("button", { name: "Home", exact: true }).click();
		const home = page.getByRole("dialog", { name: "Projects dashboard", exact: true });
		const shareBadge = home.getByRole("button", {
			name: "View share link for Shared demo",
			exact: true,
		});
		await expect(shareBadge).toHaveText(stale ? "Changes unpublished" : "Shared");
		await home
			.getByRole("button", { name: "View share link for Shared demo", exact: true })
			.click();
		await expect(page.getByLabel("Share link", { exact: true })).toHaveValue(
			"https://example.test/s/existing",
		);
		await expect(page.getByRole("button", { name: "Regenerate", exact: true })).toHaveCount(
			stale ? 1 : 0,
		);
		await expect(
			page.getByRole("progressbar", { name: "Create link", exact: true }),
		).toHaveCount(0);
		if (stale) {
			await expect(page.getByRole("button", { name: "Copy link", exact: true })).toHaveCount(
				0,
			);
			return;
		}
		await page.getByRole("button", { name: "Copy link", exact: true }).click();
		await expect(page.locator("html")).toHaveAttribute(
			"data-copied-share",
			"https://example.test/s/existing",
		);
	});
}

test("projects use four columns on wide windows and adapt below 1440px", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.listProjectFiles = async () => ({
			success: true,
			projects: [],
			entries: Array.from({ length: 8 }, (_, i) => ({
				path: `/projects/grid-${i}.recordly`,
				name: `Grid project ${i}`,
				updatedAt: 1758000000000 + i,
				thumbnailPath: null,
				isCurrent: false,
				isInProjectsDirectory: true,
			})),
		});
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const grid = page.getByRole("list", { name: "Your projects" });
	await expect(grid.locator(":scope > li")).toHaveCount(8);
	for (const [width, columns] of [
		[1440, 4],
		[1920, 4],
		[1366, 3],
	] as const) {
		await page.setViewportSize({ width, height: 1000 });
		await expect
			.poll(() =>
				grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length),
			)
			.toBe(columns);
	}
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.screenshot({
		path: "test-results/projects-four-columns.png",
		animations: "disabled",
	});
});
