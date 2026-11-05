import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("editor paints a wireframe before JavaScript loads", async ({ page }) => {
	await page.route("**/src/main.tsx*", (route) => route.abort());
	await page.goto("/?windowType=editor");
	await expect(page.getByRole("status", { name: "Loading editor" })).toBeVisible();
	await expect(page.locator(".boot-preview i").first()).toBeVisible();
	await page.screenshot({ path: "test-results/startup-wireframe.png" });
	await page.goto("/?windowType=hud-overlay");
	await expect(page.locator(".boot-editor")).not.toBeVisible();
	await expect(page.locator(".boot-home")).not.toBeVisible();
});

test("wireframe stays visible while the editor module loads, then gives way to the app", async ({
	page,
}) => {
	await installDesktopBridge(page);
	let release!: () => void;
	const paused = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/components/video-editor/EditorWindow.tsx*", async (route) => {
		await paused;
		await route.continue();
	});
	await page.goto("/?windowType=editor", { waitUntil: "domcontentloaded" });
	await expect(page.locator(".boot-shell")).toHaveCount(0);
	await expect(page.getByRole("status", { name: "Loading editor" })).toBeVisible();
	release();
	await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
	await expect(page.getByRole("status", { name: "Loading editor" })).toHaveCount(0);
});

for (const colorScheme of ["light", "dark"] as const) {
	test(`Home paints a dashboard wireframe before JavaScript loads in ${colorScheme} mode`, async ({
		page,
	}) => {
		await page.emulateMedia({ colorScheme });
		await page.route("**/src/main.tsx*", (route) => route.abort());
		await page.goto("/?windowType=editor&startupView=home");
		await expect(page.getByRole("status", { name: "Loading home", exact: true })).toBeVisible();
		await expect(page.locator(".boot-home-sidebar")).toBeVisible();
		await expect(page.locator(".boot-home-grid > div")).toHaveCount(4);
		await expect(page.locator(".boot-timeline")).not.toBeVisible();
		await page.screenshot({ path: `test-results/home-startup-${colorScheme}.png` });
	});
}

test("Home keeps its dashboard skeleton while the shared editor module loads", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getEditorStartupView = () => "home";
	});
	let release!: () => void;
	const paused = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/components/video-editor/EditorWindow.tsx*", async (route) => {
		await paused;
		await route.continue();
	});
	await page.goto("/?windowType=editor", { waitUntil: "domcontentloaded" });
	await expect(page.locator(".boot-shell")).toHaveCount(0);
	await expect(page.getByRole("status", { name: "Loading home", exact: true })).toBeVisible();
	await expect(page.getByRole("status", { name: "Loading editor", exact: true })).toHaveCount(0);
	await page.screenshot({ path: "test-results/home-react-loading.png", animations: "disabled" });
	release();
	await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
});

test("Home retains its skeleton during session lookup and then opens the dashboard", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getEditorStartupView = () => "home";
		window.electronAPI.loadCurrentProjectFile = async () => {
			await new Promise<void>((resolve) => {
				window.addEventListener("test-release-initial-project", () => resolve(), {
					once: true,
				});
				document.documentElement.dataset.homeLookupPending = "true";
			});
			return { success: false };
		};
		window.electronAPI.getCurrentRecordingSession = async () => ({
			success: false,
			session: null,
		});
		window.electronAPI.getCurrentVideoPath = async () => ({ success: false, path: null });
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator("html")).toHaveAttribute("data-home-lookup-pending", "true", {
		timeout: 30000,
	});
	await expect(page.getByRole("status", { name: "Loading home", exact: true })).toBeVisible();
	await expect(page.getByRole("status", { name: "Loading editor", exact: true })).toHaveCount(0);
	await page.evaluate(() => window.dispatchEvent(new Event("test-release-initial-project")));
	await expect(
		page.getByRole("dialog", { name: "Projects dashboard", exact: true }),
	).toBeVisible();
	await expect(page.getByRole("status", { name: "Loading home", exact: true })).toHaveCount(0);
});

test("a Home window switches to the editor wireframe on reload after a recording", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getEditorStartupView = () =>
			localStorage.getItem("test.recording-present") ? "editor" : "home";
	});
	await page.route("**/src/main.tsx*", (route) => route.abort());
	await page.goto("/?windowType=editor&startupView=home");
	await expect(page.getByRole("status", { name: "Loading home", exact: true })).toBeVisible();
	await page.evaluate(() => localStorage.setItem("test.recording-present", "true"));
	await page.reload();
	await expect(page.getByRole("status", { name: "Loading editor", exact: true })).toBeVisible();
	await expect(page.locator(".boot-home")).not.toBeVisible();
});

test("an explicit Home navigation request uses the dashboard wireframe even with an existing source", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		localStorage.setItem("recordly.open-dashboard", "true");
		window.electronAPI.getEditorStartupView = () => "editor";
	});
	await page.route("**/src/main.tsx*", (route) => route.abort());
	await page.goto("/?windowType=editor");
	await expect(page.getByRole("status", { name: "Loading home", exact: true })).toBeVisible();
	await expect(page.locator(".boot-timeline")).not.toBeVisible();
});

test("Home navigation keeps the Home skeleton while a retained project finishes hydration", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		localStorage.setItem("recordly.open-dashboard", "true");
		window.electronAPI.getEditorStartupView = () => "editor";
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true,
			path: "/projects/retained.recordly",
			project: {
				version: 2,
				videoPath: `${location.origin}/tests/ui/fixtures/preview.mp4`,
				editor: {},
			},
		});
		window.electronAPI.setCurrentVideoPath = async () => {
			document.documentElement.dataset.retainedProjectApplied = "true";
			return { success: true };
		};
		let released = false;
		window.addEventListener("test-release-retained-library", () => {
			released = true;
		});
		window.electronAPI.listProjectFiles = async () => {
			if (document.documentElement.dataset.retainedProjectApplied && !released) {
				await new Promise<void>((resolve) => {
					window.addEventListener("test-release-retained-library", () => resolve(), {
						once: true,
					});
					document.documentElement.dataset.retainedLibraryPending = "true";
				});
			}
			return { success: true, projects: [], entries: [] };
		};
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator("html")).toHaveAttribute("data-retained-library-pending", "true", {
		timeout: 30000,
	});
	await expect(page.getByRole("status", { name: "Loading home", exact: true })).toBeVisible();
	await expect(page.getByRole("status", { name: "Loading editor", exact: true })).toHaveCount(0);
	await page.evaluate(() => window.dispatchEvent(new Event("test-release-retained-library")));
	await expect(
		page.getByRole("dialog", { name: "Projects dashboard", exact: true }),
	).toBeVisible();
});

for (const width of [1440, 800]) {
	test(`startup editor wireframe matches the live frame at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 900 });
		await installDesktopBridge(page);
		await installDesktopBridgeOverrides(page, () => {
			// Compare the normal editor frame; the bootstrap has no update notification.
			window.electronAPI.getCurrentUpdateToastPayload = async () => null;
		});
		await page.route("**/src/main.tsx*", (route) => route.abort());
		await page.goto("/?windowType=editor");
		const wireframe = {
			header: await page.locator(".boot-editor .boot-header").boundingBox(),
			inspector: await page.locator(".boot-settings").boundingBox(),
			timeline: await page.locator(".boot-timeline").boundingBox(),
			preview: await page.locator(".boot-canvas .loading-preview-frame").boundingBox(),
			playback: await page.locator(".boot-editor .loading-playback").boundingBox(),
		};
		await expect(page.locator(".boot-rail i")).toHaveCount(4);
		await page.screenshot({ path: `test-results/editor-wireframe-${width}.png` });
		await page.unroute("**/src/main.tsx*");
		await page.reload();
		await expect(page.locator(".editor-inspector")).toBeVisible();
		await expect(page.locator(".app-update-banner")).toHaveCount(0);
		const live = {
			header: await page.locator(".editor-header").boundingBox(),
			inspector: await page.locator(".editor-inspector .app-frame-surface").boundingBox(),
			timeline: await page.locator("[data-timeline-panel]").boundingBox(),
			preview: await page.locator(".editor-preview-frame").boundingBox(),
			playback: await page.locator(".editor-playback").boundingBox(),
		};
		for (const region of ["header", "inspector", "timeline", "preview", "playback"] as const) {
			for (const dimension of ["x", "y", "width", "height"] as const) {
				expect(
					Math.abs(wireframe[region]![dimension] - live[region]![dimension]),
					`${region} ${dimension}`,
				).toBeLessThan(2);
			}
		}
		await page.screenshot({ path: `test-results/editor-live-${width}.png` });
	});
}
