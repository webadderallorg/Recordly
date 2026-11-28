import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function openClips(page: Page) {
	await page.getByRole("button", { name: "Add", exact: true }).click();
	await page.getByRole("menuitem", { name: "Import from Clips", exact: true }).click();
}

async function setup(page: Page) {
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.openRecordingsFolder = async () => {
			document.documentElement.dataset.recordingsFolderOpened = "true";
			return { success: true };
		};
		const removed = new Set<string>();
		const entries = ["first.mp4", "second.mp4"].map((name, i) => ({
			name,
			path: `/recordings/${name}`,
			bytes: 1024 * 1024,
			createdAt: Date.now() - i * 1000,
			url: `${location.origin}/tests/ui/fixtures/filmstrip.mp4`,
		}));
		window.electronAPI.getRecordingThumbnail = async () => ({
			success: true,
			value: `${location.origin}/tests/ui/fixtures/recording-thumbnail.jpg`,
		});
		window.electronAPI.listRecordings = async () => ({
			success: true,
			value: entries.filter((entry) => !removed.has(entry.path)),
		});
		window.electronAPI.setRecordingsRemoved = async (paths, hide) => {
			for (const path of paths) {
				if (hide) removed.add(path);
				else removed.delete(path);
			}
			return { success: true, value: null };
		};
		window.electronAPI.importRecording = async (_current, path) => {
			document.documentElement.dataset.importedPath = path;
			// Playback remains real HTML video; backend media composition has its own FFmpeg integration test.
			return {
				success: true,
				value: {
					path: `${location.origin}/tests/ui/fixtures/filmstrip.mp4`,
					url: `${location.origin}/tests/ui/fixtures/filmstrip.mp4`,
					sourceStartMs: 2000,
					durationMs: 1000,
					totalDurationMs: 6000,
					webcam: {
						sourcePath: `${location.origin}/tests/ui/fixtures/filmstrip.mp4`,
						timeOffsetMs: 0,
						visibleRanges: [{ startMs: 2000, endMs: 3000 }],
					},
				},
			};
		};
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]')).toHaveAttribute("data-end-ms", "6000", {
		timeout: 20000,
	});
}

test("Clips supports selection, remove all, undo and real timeline drag insertion", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await setup(page);
	await expect(page.locator('[data-variant="clip"] img').first()).toBeVisible();
	await expect(page.getByLabel("Loading preview")).toHaveCount(0);
	await openClips(page);
	await expect(page.getByLabel("Select first.mp4")).toBeVisible();
	const panel = page.getByRole("complementary", { name: "Clips" });
	await panel.getByRole("button", { name: "Open recordings folder", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-recordings-folder-opened", "true");
	await expect(
		panel.getByRole("button", { name: "Clip library actions", exact: true }),
	).toHaveCount(0);
	await expect(panel.locator("video")).toHaveCount(0);
	await expect(panel.getByRole("img", { name: "Preview of first.mp4" })).toBeVisible();
	await expect
		.poll(() =>
			panel
				.getByRole("img", { name: "Preview of first.mp4" })
				.evaluate((image: HTMLImageElement) => image.naturalWidth),
		)
		.toBeGreaterThan(0);
	expect((await panel.boundingBox())!.x).toBeLessThan(100);
	await panel.getByLabel("Select first.mp4").click();
	await expect(panel.getByLabel("Select first.mp4")).toHaveAttribute("aria-pressed", "true");
	await panel.getByRole("button", { name: "Move selected videos to Trash", exact: true }).click();
	await expect(page.getByLabel("Select first.mp4")).toHaveCount(0);
	await page.keyboard.press("Meta+z");
	await expect(page.getByLabel("Select first.mp4")).toBeVisible();
	await panel.getByText("Select all", { exact: true }).click();
	await panel.getByRole("button", { name: "Move selected videos to Trash", exact: true }).click();
	await expect(panel.getByText("Your recordings appear here")).toBeVisible();
	await page.keyboard.press("Control+z");
	await expect(page.getByLabel("Select second.mp4")).toBeVisible();
	const card = panel.locator('[data-recording-path="/recordings/second.mp4"]');
	const clip = page.locator('[data-variant="clip"]');
	await card.dragTo(clip, { targetPosition: { x: 5, y: 15 } });
	await expect(page.locator("html")).toHaveAttribute(
		"data-imported-path",
		"/recordings/second.mp4",
	);
	await expect(clip).toHaveCount(2);
	await expect(clip.first()).toHaveAttribute("data-end-ms", "1000");
	await expect(clip.last()).toHaveAttribute("data-start-ms", "1000");
	await expect(page.locator("[data-webcam-overlay]")).toBeVisible();
	await expect(page.getByLabel("Loading preview")).toHaveCount(0);
	await page.keyboard.press("Meta+z");
	await expect(clip).toHaveCount(1);
	await expect(clip).toHaveAttribute("data-end-ms", "6000");
	await expect(page.locator("[data-webcam-overlay]")).toBeHidden();
	await page.keyboard.press("Meta+Shift+z");
	await expect(clip).toHaveCount(2);
	await expect(panel.getByRole("searchbox")).toHaveCount(0);
	await expect(panel.locator("[data-recording-path]")).toHaveCount(2);
	await expect(panel.getByRole("img", { name: "Preview of second.mp4" })).toBeVisible();
	await page.screenshot({
		path: test.info().outputPath("videos-panel.png"),
		animations: "disabled",
	});
	await panel.getByRole("button", { name: "Close Clips", exact: true }).click();
	await expect(panel).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Add", exact: true })).toBeFocused();
	await expect(page.getByRole("slider", { name: "Blur", exact: true })).toBeVisible();
	expect(errors).toEqual([]);
});

test("Add Layer imports an external video into the current timeline and handles Cancel", async ({
	page,
}) => {
	test.setTimeout(60000);
	await setup(page);
	await page.evaluate(() => {
		let cancel = true;
		window.electronAPI.openVideoFilePicker = async (options) => {
			document.documentElement.dataset.preserveProject = String(options?.preserveProjectPath);
			if (cancel) {
				cancel = false;
				return { success: false, canceled: true };
			}
			return { success: true, kind: "media", path: "/picked/outside.mp4" };
		};
		window.electronAPI.importRecording = async (_current, path) => {
			document.documentElement.dataset.importedPath = path;
			const url = `${location.origin}/tests/ui/fixtures/filmstrip.mp4`;
			return {
				success: true,
				value: {
					path: url,
					url,
					sourceStartMs: 6000,
					durationMs: 1000,
					totalDurationMs: 7000,
				},
			};
		};
	});
	const clips = page.locator('[data-variant="clip"]');
	const add = page.getByRole("button", { name: "Add", exact: true });
	const importVideo = page.getByRole("menuitem", { name: "Import from device…", exact: true });
	await expect(clips).toHaveCount(1);
	await add.click();
	await importVideo.click();
	await expect(page.locator("html")).toHaveAttribute("data-preserve-project", "true");
	await expect(page.locator("html")).not.toHaveAttribute("data-imported-path");
	await expect(clips).toHaveCount(1);

	await add.click();
	await importVideo.click();
	await expect(page.locator("html")).toHaveAttribute("data-imported-path", "/picked/outside.mp4");
	await expect(clips).toHaveCount(2);
	await expect(clips.last()).toHaveAttribute("data-start-ms", "6000");
	await expect(clips.last()).toHaveAttribute("data-end-ms", "7000");
});

test("an import cannot replace another project that uses the same recording", async ({ page }) => {
	test.setTimeout(60000);
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
		const videoPath = `${location.origin}/tests/ui/fixtures/filmstrip.mp4`;
		const outputPath = "/recordings/combined.mp4";
		const secondPath = "/projects/Second.recordly";
		const project = (projectId: string, endMs: number) => ({
			version: 2,
			projectId,
			videoPath,
			editor: { clipRegions: [{ id: "clip-1", startMs: 0, endMs, speed: 1 }] },
		});
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true,
			path: "/projects/First.recordly",
			project: project("first", 6000),
		});
		window.electronAPI.saveProjectFile = async (_data, _name, path) => ({
			success: true,
			path,
			projectId: "first",
		});
		window.electronAPI.listProjectFiles = async () => ({
			success: true,
			entries: [
				{
					path: secondPath,
					name: "Second",
					updatedAt: Date.now(),
					thumbnailPath: null,
					isCurrent: false,
					isInProjectsDirectory: true,
				},
			],
		});
		window.electronAPI.openProjectFileAtPath = async (path) => ({
			success: true,
			path,
			project: project("second", 3500),
		});
		window.electronAPI.onMenuLoadProject = (open) => {
			window.addEventListener("test-open-projects", open);
			return () => window.removeEventListener("test-open-projects", open);
		};
		window.electronAPI.openVideoFilePicker = async () => ({
			success: true,
			kind: "media",
			path: "/picked/outside.mp4",
		});
		window.electronAPI.importRecording = async () => ({
			success: true,
			value: {
				path: outputPath,
				url: videoPath,
				sourceStartMs: 6000,
				durationMs: 1000,
				totalDurationMs: 7000,
			},
		});
		window.electronAPI.finishRecordingImport = async (path, accept) => {
			if (path === outputPath && !accept) {
				document.documentElement.dataset.importFinalizing = "true";
				await new Promise<void>((resolve) =>
					window.addEventListener("test-finish-import", () => resolve(), { once: true }),
				);
			} else {
				document.documentElement.dataset.importRetainedPath = path;
			}
			return { success: true, value: null };
		};
	});
	await page.goto("/?windowType=editor");
	const clips = page.locator('[data-variant="clip"]');
	await expect(clips).toHaveAttribute("data-end-ms", "6000", { timeout: 20000 });
	await page.getByRole("button", { name: "Add", exact: true }).click();
	await page.getByRole("menuitem", { name: "Import from device…", exact: true }).click();
	const html = page.locator("html");
	await expect(html).toHaveAttribute("data-import-finalizing", "true");

	await page.evaluate(() => window.dispatchEvent(new Event("test-open-projects")));
	const dashboard = page.getByRole("dialog", { name: "Projects dashboard", exact: true });
	await dashboard.getByRole("button", { name: "Second", exact: true }).click();
	await expect(page.getByRole("button", { name: "Rename project" })).toHaveText("Second");
	await expect(clips).toHaveAttribute("data-end-ms", "3500");
	await page.evaluate(() => window.dispatchEvent(new Event("test-finish-import")));
	await expect(
		page.getByText("The project changed while importing.", { exact: false }),
	).toBeVisible();
	await expect(html).toHaveAttribute("data-import-retained-path", /filmstrip\.mp4$/);
	await expect(clips).toHaveCount(1);
	await expect(clips).toHaveAttribute("data-end-ms", "3500");
});

test("generating captions leaves the current media session intact and shows the cues", async ({
	page,
}) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getCurrentVideoPath = async () => ({
			success: true,
			path: "/recordings/caption-test.mp4",
		});
		window.electronAPI.getLocalMediaUrl = async () => ({
			success: true,
			url: `${location.origin}/tests/ui/fixtures/filmstrip.mp4`,
		});
		window.electronAPI.getCaptionModelStatus = async () => ({
			success: true,
			exists: true,
			path: "/models/parakeet-v3",
		});
		window.electronAPI.generateAutoCaptions = async (options) => {
			document.documentElement.dataset.captionEngine = options.engine;
			document.documentElement.dataset.captionModel = options.parakeetModelPath;
			return {
				success: true,
				cues: [
					{
						id: "cue-1",
						startMs: 0,
						endMs: 4000,
						text: "Generated caption is visible",
						words: [
							{ text: "Generated", startMs: 0, endMs: 700 },
							{ text: "caption", startMs: 900, endMs: 1800, leadingSpace: true },
							{ text: "is", startMs: 2100, endMs: 2400, leadingSpace: true },
							{ text: "visible", startMs: 2700, endMs: 4000, leadingSpace: true },
						],
					},
				],
			};
		};
		window.electronAPI.setCurrentVideoPath = async () => {
			document.documentElement.dataset.sessionReset = "true";
			return { success: true };
		};
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"] img').first()).toBeVisible({
		timeout: 20000,
	});
	await page.getByRole("radio", { name: "Captions", exact: true }).click();
	await page.getByRole("button", { name: "Generate Captions", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Edit current caption", exact: true }),
	).toHaveText("Generated caption is visible");
	const preview = page.getByRole("button", { name: "Edit current caption", exact: true });
	await expect(preview.getByText("Generated", { exact: true })).toHaveCSS(
		"color",
		"rgb(255, 255, 255)",
	);
	await expect(preview.getByText("caption", { exact: true })).toHaveCSS(
		"color",
		"rgb(163, 163, 163)",
	);
	await expect(page.locator("html")).not.toHaveAttribute("data-session-reset", "true");
	await expect(page.locator("html")).toHaveAttribute("data-caption-engine", "parakeet");
	await expect(page.locator("html")).toHaveAttribute("data-caption-model", "/models/parakeet-v3");
	await page.getByRole("button", { name: "Play", exact: true }).click();
	await expect
		.poll(() =>
			page
				.locator('video[aria-hidden="true"]')
				.evaluate((node: HTMLVideoElement) => node.currentTime),
		)
		.toBeGreaterThan(0.1);
	await expect(page.getByText(/Failed to load video/)).toHaveCount(0);
});

test("preview recovers once when a local video URL fails to load", async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
		let requests = 0;
		window.electronAPI.getCurrentVideoPath = async () => ({
			success: true,
			path: "/recordings/first.mp4",
		});
		window.electronAPI.getLocalMediaUrl = async () => ({
			success: true,
			url:
				++requests === 1
					? `${location.origin}/missing-source.mp4`
					: `${location.origin}/tests/ui/fixtures/filmstrip.mp4`,
		});
	});
	await page.route("**/missing-source.mp4", (route) => route.abort("connectionfailed"));
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]')).toHaveAttribute("data-end-ms", "6000", {
		timeout: 20000,
	});
	await expect(page.getByLabel("Loading preview")).toHaveCount(0);
	await expect(page.getByText(/Failed to load video/)).toHaveCount(0);
});

test("dashboard project list scrolls vertically with long names", async ({ page }) => {
	await page.setViewportSize({ width: 980, height: 600 });
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.listProjectFiles = async () => ({
			success: true,
			projects: [],
			entries: Array.from({ length: 30 }, (_, i) => ({
				path: `/projects/${i}.recordly`,
				name: `An extremely long project name that should never force sideways scrolling ${i}`,
				updatedAt: Date.now(),
				thumbnailPath: null,
				isCurrent: false,
				isInProjectsDirectory: true,
			})),
		});
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const home = page.getByRole("dialog", { name: "Projects dashboard" });
	const entry = home.getByRole("button", {
		name: /^An extremely long project/,
	});
	await expect(entry).toHaveCount(30);
	const content = home.getByRole("main");
	expect(await content.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
	await entry.last().scrollIntoViewIfNeeded();
	await expect(entry.last()).toBeInViewport();
	await page.screenshot({
		path: test.info().outputPath("dashboard-projects-vertical.png"),
	});
});

test("HUD source control and Linux source rows have no default gray fill or outline", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getPlatform = async () => "linux";
		window.electronAPI.getSources = async () => [
			{
				id: "screen:1:0",
				name: "Built-in Display",
				thumbnail: null,
				appIcon: null,
				display_id: "1",
			},
			{
				id: "window:2:0",
				name: "Another Window",
				thumbnail: null,
				appIcon: null,
				display_id: "",
			},
		];
	});
	await page.goto("/?windowType=hud-overlay");
	const source = page.getByRole("button", {
		name: "Choose recording source",
		exact: true,
	});
	await expect(source).toContainText("Built-in Display");
	expect(await source.evaluate((node) => getComputedStyle(node).borderWidth)).toBe("0px");
	await page.mouse.move(1, 1);
	await expect(source).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
	// The source list now lives in its own Linux window; macOS uses the native picker.
	await page.goto("/?windowType=source-selector");
	const row = page.getByRole("button", { name: "Another Window", exact: true });
	await expect(row).toBeVisible();
	await page.mouse.move(1, 1);
	await expect(row).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
});

test("Clips shows duration and recording details in a flat, filterable grid", async ({ page }) => {
	test.setTimeout(60_000);
	await setup(page);
	await page.evaluate(() => {
		const now = Date.now();
		const day = 86_400_000;
		const recordings = [
			...Array.from({ length: 18 }, (_, index) => ({
				name: `recent-${index}.mp4`,
				createdAt: now - index * 1000,
			})),
			{ name: "last-month.mp4", createdAt: now - 14 * day },
			{ name: "older-recording.mp4", createdAt: now - 40 * day },
		];
		window.electronAPI.listRecordings = async () => ({
			success: true,
			value: recordings.map(({ name, createdAt }) => ({
				path: `/recordings/${name}`,
				name,
				bytes: 1024,
				createdAt,
				fileCreatedAt: Date.UTC(2020, 6, 15, 12),
				url: "",
			})),
		});
		window.electronAPI.probeNativeVideoMetadata = async () => ({
			success: true,
			metadata: {
				width: 1920,
				height: 1080,
				duration: 125,
				frameRate: 30,
				codec: "h264",
				hasAudio: false,
			},
		});
		let imported = 0;
		window.electronAPI.importRecording = async (_current, path) => {
			document.documentElement.dataset.importOrder =
				(document.documentElement.dataset.importOrder || "") + path + ";";
			const url = `${location.origin}/tests/ui/fixtures/filmstrip.mp4`;
			return {
				success: true,
				value: {
					path: `/sequence-${++imported}.mp4`,
					url,
					sourceStartMs: 6000 + (imported - 1) * 1000,
					durationMs: 1000,
					totalDurationMs: 6000 + imported * 1000,
				},
			};
		};
	});
	await openClips(page);
	const panel = page.getByRole("complementary", { name: "Clips" });
	const cards = panel.locator("[data-recording-path]");
	const recent = panel.getByLabel("Select recent-0.mp4");
	const older = panel.getByLabel("Select older-recording.mp4");
	const importButton = panel.getByRole("button", { name: "Import", exact: true });
	await expect(cards).toHaveCount(20);
	await expect(importButton).toBeDisabled();
	await expect(recent.locator("[data-thumbnail-duration]")).toHaveText("2:05");
	await expect(panel.getByRole("heading", { level: 3 })).toHaveCount(0);
	await expect(panel.getByRole("img", { name: "Preview of recent-0.mp4" })).toBeVisible();
	await expect(panel.getByRole("button", { name: /^Show details/ })).toHaveCount(0);
	await recent.hover();
	const tooltip = page.getByRole("tooltip");
	await expect(tooltip.getByText("recent-0.mp4", { exact: true })).toBeVisible();
	await expect(tooltip.locator("time")).toHaveAttribute("datetime", "2020-07-15T12:00:00.000Z");
	await expect(tooltip).toContainText("Last created");
	await expect(tooltip).toContainText("kB");
	const allDates = panel.getByRole("button", { name: "Time filters, All", exact: true });
	await allDates.hover();
	await expect(tooltip).toHaveCount(0);
	await allDates.press("Tab");
	await expect(recent).toBeFocused();
	await expect(tooltip.getByText("recent-0.mp4", { exact: true })).toBeVisible();
	await expect(recent).toHaveAttribute("aria-pressed", "false");
	await expect(older).not.toBeInViewport();
	await older.click();
	await expect(older).toBeInViewport();
	const previous = (await panel.getByLabel("Select last-month.mp4").boundingBox())!;
	const last = (await older.boundingBox())!;
	expect(last.y).toBe(previous.y);
	expect(last.x).toBeGreaterThan(previous.x);
	await expect(importButton).toBeInViewport();

	await allDates.click();
	await expect(page.getByRole("menu", { name: "Time filters" })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(allDates).toBeFocused();
	await allDates.click();
	await page.getByRole("menuitemradio", { name: "Last 7 days" }).press("Space");
	await expect(cards).toHaveCount(18);
	await expect(recent).toBeInViewport();
	await expect(panel.getByLabel("Select all videos")).not.toBeChecked();
	const lastWeek = panel.getByRole("button", { name: "Time filters, Last 7 days", exact: true });
	await page.keyboard.press("Escape");
	await expect(lastWeek).toBeFocused();
	await lastWeek.click();
	await page.getByRole("menuitemradio", { name: "Last 30 days" }).click();
	await expect(cards).toHaveCount(19);
	await expect(panel.getByText("1 selected")).toBeVisible();

	await recent.press("Space");
	const rangeEnd = panel.getByLabel("Select recent-2.mp4");
	await rangeEnd.click({ modifiers: ["Shift"] });
	await expect(panel.getByLabel("Select recent-1.mp4")).toHaveAttribute("aria-pressed", "true");
	await expect(panel.getByText("4 selected")).toBeVisible();
	await panel.getByLabel("Select recent-1.mp4").click();
	await rangeEnd.click();
	await expect(panel.getByText("2 selected")).toBeVisible();
	await page.screenshot({
		path: test.info().outputPath("clips-gallery.png"),
		animations: "disabled",
	});
	await importButton.click();
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(3);
	await expect(page.locator("html")).toHaveAttribute(
		"data-import-order",
		"/recordings/recent-0.mp4;/recordings/older-recording.mp4;",
	);
	await expect(importButton).toBeDisabled();
});

for (const enabled of [true, false]) {
	test(`imported recordings stay unzoomed with automatic zooms ${enabled ? "on" : "off"}`, async ({
		page,
	}) => {
		test.setTimeout(60_000);
		await setup(page);
		await installDesktopBridgeOverrides(page, () => {
			const get = window.electronAPI.getAppSetting;
			window.electronAPI.getAppSetting = (key) =>
				key === "recordly.editor.preferences.v2"
					? JSON.parse(localStorage.getItem(key) ?? "{}")
					: get(key);
		});
		await page.evaluate((enabled) => {
			const prefs = JSON.parse(
				localStorage.getItem("recordly.editor.preferences.v2") || "{}",
			);
			localStorage.setItem(
				"recordly.editor.preferences.v2",
				JSON.stringify({ ...prefs, autoApplyFreshRecordingAutoZooms: enabled }),
			);
		}, enabled);
		await page.reload();
		await expect(page.locator('[data-variant="clip"]')).toHaveCount(1, { timeout: 20_000 });
		await page.getByRole("button", { name: "Settings", exact: true }).click();
		const settings = page.getByRole("dialog", { name: "Settings", exact: true });
		await settings.getByRole("tab", { name: "Motion", exact: true }).click();
		const automatic = settings.getByRole("switch", {
			name: "Automatically add zooms",
			exact: true,
		});
		if (enabled) await expect(automatic).toBeChecked();
		else await expect(automatic).not.toBeChecked();
		await page.keyboard.press("Escape");
		await openClips(page);
		await page.evaluate(() => {
			let count = 0;
			window.electronAPI.importRecording = async (current, path) => {
				count++;
				document.documentElement.dataset.importOrder =
					(document.documentElement.dataset.importOrder || "") + path + ";";
				document.documentElement.dataset.importSource = current;
				return {
					success: true,
					value: {
						path: `/sequence-${count}.mp4`,
						url: `${location.origin}/tests/ui/fixtures/filmstrip.mp4`,
						sourceStartMs: 6000 + (count - 1) * 1000,
						durationMs: 1000,
						totalDurationMs: 6000 + count * 1000,
					},
				};
			};
			window.electronAPI.getCursorTelemetry = async () => ({
				success: true,
				samples: [
					{ timeMs: 6500, cx: 0.4, cy: 0.4, interactionType: "click" },
					{ timeMs: 7500, cx: 0.6, cy: 0.6, interactionType: "click" },
				],
			});
		});
		const panel = page.getByRole("complementary", { name: "Clips" });
		await panel.getByText("Select all", { exact: true }).click();
		await expect(page.getByLabel("Select first.mp4")).toHaveAttribute("aria-pressed", "true");
		await expect(page.getByLabel("Select second.mp4")).toHaveAttribute("aria-pressed", "true");
		await panel
			.locator('[data-recording-path="/recordings/second.mp4"]')
			.dragTo(page.locator('[data-variant="clip"]'), {
				targetPosition: { x: 5, y: 15 },
			});
		await expect(page.locator('[data-variant="clip"]')).toHaveCount(3);
		await expect(page.locator("html")).toHaveAttribute(
			"data-import-order",
			"/recordings/first.mp4;/recordings/second.mp4;",
		);
		await expect(page.locator("html")).toHaveAttribute("data-import-source", "/sequence-1.mp4");
		await expect(page.locator('[data-variant="zoom"]')).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "Apply auto zooms", exact: true }),
		).toBeVisible();
	});
}

test("cancelling a batch keeps completed clips and stops the remaining import", async ({
	page,
}) => {
	await setup(page);
	await page.evaluate(() => {
		let count = 0;
		let finish: ((result: { success: false; error: string }) => void) | undefined;
		window.electronAPI.importRecording = async () => {
			count++;
			if (count === 1)
				return {
					success: true,
					value: {
						path: "/sequence-first.mp4",
						url: `${location.origin}/tests/ui/fixtures/filmstrip.mp4`,
						sourceStartMs: 6000,
						durationMs: 1000,
						totalDurationMs: 7000,
					},
				};
			document.documentElement.dataset.pendingImport = "true";
			return new Promise((resolve) => {
				finish = resolve;
			});
		};
		window.electronAPI.cancelRecordingImport = async () => {
			finish?.({ success: false, error: "Cancelled" });
			return { success: true };
		};
	});
	const panel = page.getByRole("complementary", { name: "Clips" });
	await openClips(page);
	await panel.getByText("Select all", { exact: true }).click();
	await panel.getByRole("button", { name: "Import", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-pending-import", "true");
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(page.getByText("Adding video…")).toHaveCount(0);
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(2);
	await expect(panel.getByLabel("Select first.mp4")).toHaveAttribute("aria-pressed", "false");
	await expect(panel.getByLabel("Select second.mp4")).toHaveAttribute("aria-pressed", "true");
});
