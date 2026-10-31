import { expect, test, type Page } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function setup(page: Page) {
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
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
	await expect(page.locator('[data-variant="clip"] img').first()).toBeVisible();
	await expect(page.getByLabel("Loading preview")).toHaveCount(0);
	await page.getByRole("button", { name: "Clips", exact: true }).click();
	await expect(page.getByLabel("Select first.mp4")).toBeVisible();
}

test("Clips supports selection, remove all, undo and real timeline drag insertion", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await setup(page);
	const panel = page.getByRole("complementary", { name: "Clips" });
	await expect(panel.locator("video")).toHaveCount(0);
	await expect(panel.getByRole("img", { name: "Preview of first.mp4" })).toBeVisible();
	await expect
		.poll(() =>
			panel
				.getByRole("img", { name: "Preview of first.mp4" })
				.evaluate((image: HTMLImageElement) => image.naturalWidth),
		)
		.toBeGreaterThan(0);
	await expect(panel.getByText("first.mp4", { exact: true })).toBeVisible();
	const videosButton = page.getByRole("button", { name: "Clips", exact: true });
	expect((await videosButton.boundingBox())!.x).toBeGreaterThan(
		(await page.getByRole("button", { name: "Rename project", exact: true }).boundingBox())!.x,
	);
	expect((await panel.boundingBox())!.x).toBeLessThan(100);
	await expect(videosButton).toHaveClass(/button--secondary/);
	await panel
		.locator('[data-recording-path="/recordings/first.mp4"] [data-slot="checkbox-control"]')
		.click();
	await expect(page.getByLabel("Select first.mp4")).toBeChecked();
	await panel.getByRole("button", { name: "Move selected videos to Trash", exact: true }).click();
	await expect(page.getByLabel("Select first.mp4")).toHaveCount(0);
	await page.keyboard.press("Meta+z");
	await expect(page.getByLabel("Select first.mp4")).toBeVisible();
	await panel.getByRole("button", { name: "Clip library actions", exact: true }).click();
	await page.getByRole("menuitem", { name: "Move all to Trash", exact: true }).click();
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
	await panel.getByRole("searchbox", { name: "Search videos" }).fill("first");
	await expect(panel.locator("[data-recording-path]")).toHaveCount(1);
	await panel.getByRole("searchbox", { name: "Search videos" }).fill("");
	await expect(panel.locator("[data-recording-path]")).toHaveCount(2);
	await expect(panel.getByRole("img", { name: "Preview of second.mp4" })).toBeVisible();
	await page.screenshot({ path: "test-results/videos-panel.png", animations: "disabled" });
	await page.getByRole("radio", { name: "Scene", exact: true }).click();
	await expect(panel).toHaveCount(0);
	await expect(page.getByRole("slider", { name: "Blur", exact: true })).toBeVisible();
	expect(errors).toEqual([]);
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
		window.electronAPI.getWhisperSmallModelStatus = async () => ({
			success: true,
			exists: true,
			path: "/models/small.bin",
		});
		window.electronAPI.generateAutoCaptions = async () => ({
			success: true,
			cues: [{ id: "cue-1", startMs: 0, endMs: 4000, text: "Generated caption is visible" }],
		});
		window.electronAPI.setCurrentVideoPath = async () => {
			document.documentElement.dataset.sessionReset = "true";
			return { success: true };
		};
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"] img').first()).toBeVisible();
	await page.getByRole("radio", { name: "Captions", exact: true }).click();
	await page.getByRole("button", { name: "Generate Captions", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Edit current caption", exact: true }),
	).toHaveText("Generated caption is visible");
	await expect(page.locator("html")).not.toHaveAttribute("data-session-reset", "true");
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
	await expect(page.locator('[data-variant="clip"]')).toHaveAttribute("data-end-ms", "6000");
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
	const entry = home.getByRole("button", { name: /^An extremely long project/ });
	await expect(entry).toHaveCount(30);
	const content = home.getByRole("main");
	expect(await content.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
	await entry.last().scrollIntoViewIfNeeded();
	await expect(entry.last()).toBeInViewport();
	await page.screenshot({ path: "test-results/dashboard-projects-vertical.png" });
});

test("HUD source controls have no default gray fill or outline", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getSources = async () => [
			{ id: "screen:1:0", name: "Built-in Display", thumbnail: "", display_id: "1" },
			{ id: "window:2:0", name: "Another Window", thumbnail: "", display_id: "" },
		];
	});
	await page.goto("/?windowType=hud-overlay");
	const source = page.getByRole("button", { name: "Built-in Display", exact: true });
	expect(await source.evaluate((node) => getComputedStyle(node).borderWidth)).toBe("0px");
	await source.click();
	const row = page.locator(".source-selector-item").filter({ hasText: "Another Window" });
	await expect(row).toBeVisible();
	await page.mouse.move(1, 1);
	await expect(row).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
});

test("Clips shows original filenames and truncates long names beside real still previews", async ({
	page,
}) => {
	await setup(page);
	await page.evaluate(() => {
		window.electronAPI.listRecordings = async () => ({
			success: true,
			value: [
				"recording-1789866953739.mp4",
				"client-onboarding-walkthrough-with-a-very-long-file-name.mp4",
			].map((name) => ({
				path: `/recordings/${name}`,
				name,
				bytes: 1024,
				createdAt: Date.now(),
				url: "",
			})),
		});
	});
	const toggle = page.getByRole("button", { name: "Clips", exact: true });
	await toggle.click();
	await toggle.click();
	const panel = page.getByRole("complementary", { name: "Clips" });
	await expect(panel.getByText("recording-1789866953739.mp4", { exact: true })).toBeVisible();
	const name = panel.getByText("client-onboarding-walkthrough-with-a-very-long-file-name.mp4", {
		exact: true,
	});
	await expect(name).toBeVisible();
	expect(
		await name.evaluate((node) => ({
			overflow: getComputedStyle(node).textOverflow,
			clipped: node.scrollWidth > node.clientWidth,
		})),
	).toEqual({ overflow: "ellipsis", clipped: true });
	await expect(panel.locator("img")).toHaveCount(2);
	await expect
		.poll(() =>
			panel
				.locator("img")
				.evaluateAll((images) =>
					images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
				),
		)
		.toBe(true);
	expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
	await page.screenshot({ path: "test-results/videos-filenames.png", animations: "disabled" });
});

for (const enabled of [true, false]) {
	test(`selected recordings drag together; imported click zooms ${enabled ? "on" : "off"}`, async ({
		page,
	}) => {
		await setup(page);
		await page.evaluate((enabled) => {
			const prefs = JSON.parse(localStorage.getItem("recordly.editor.preferences") || "{}");
			localStorage.setItem(
				"recordly.editor.preferences",
				JSON.stringify({ ...prefs, autoApplyFreshRecordingAutoZooms: enabled }),
			);
		}, enabled);
		await page.reload();
		await expect(page.locator('[data-variant="clip"]')).toHaveCount(1);
		await page.getByRole("button", { name: "Clips", exact: true }).click();
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
		await panel.locator('[data-slot="checkbox-control"]').first().click();
		await expect(page.getByLabel("Select first.mp4")).toBeChecked();
		await expect(page.getByLabel("Select second.mp4")).toBeChecked();
		await panel
			.locator('[data-recording-path="/recordings/second.mp4"]')
			.dragTo(page.locator('[data-variant="clip"]'), { targetPosition: { x: 5, y: 15 } });
		await expect(page.locator('[data-variant="clip"]')).toHaveCount(3);
		await expect(page.locator("html")).toHaveAttribute(
			"data-import-order",
			"/recordings/first.mp4;/recordings/second.mp4;",
		);
		await expect(page.locator("html")).toHaveAttribute("data-import-source", "/sequence-1.mp4");
		await expect(page.locator('[data-variant="zoom"]')).toHaveCount(enabled ? 2 : 0);
		if (enabled) {
			await expect(page.locator('[data-variant="zoom"]').first()).toHaveAttribute(
				"data-start-ms",
				"0",
			);
			await expect(page.locator('[data-variant="zoom"]').nth(1)).toHaveAttribute(
				"data-start-ms",
				"1000",
			);
		}
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
	await panel.locator('[data-slot="checkbox-control"]').first().click();
	await panel
		.locator('[data-recording-path="/recordings/second.mp4"]')
		.dragTo(page.locator('[data-variant="clip"]'), { targetPosition: { x: 5, y: 15 } });
	await expect(page.locator("html")).toHaveAttribute("data-pending-import", "true");
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(page.getByText("Adding video…")).toHaveCount(0);
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(2);
});
