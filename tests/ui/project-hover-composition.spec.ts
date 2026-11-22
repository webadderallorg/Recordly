import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test.setTimeout(90000);

type DelayedLayer =
	| "webcam"
	| "background"
	| "caption"
	| "text"
	| "video"
	| "metadata"
	| "annotation";

async function openProject(page: Page, layer: DelayedLayer) {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(
		page,
		(layer) => {
			window.electronAPI.listProjectFiles = async () => ({
				success: true,
				entries: [
					{
						path: "/projects/complete-scene.recordly",
						name: "Complete scene",
						updatedAt: 1,
						thumbnailPath: `${location.origin}/tests/ui/fixtures/recording-thumbnail.jpg`,
						isCurrent: false,
						isInProjectsDirectory: true,
					},
				],
			});
			window.electronAPI.getProjectPreview = async () => {
				if (layer === "metadata")
					await new Promise<void>((resolve) => {
						Object.assign(window, { releaseHoverMetadata: resolve });
					});
				return {
					success: true,
					value: {
						videoUrl: `${location.origin}/tests/ui/fixtures/filmstrip.mp4`,
						webcamUrl:
							layer === "webcam" ? `${location.origin}/hover-camera.mp4` : null,
						project: {
							version: 1,
							videoPath: "/recordings/complete-scene.mp4",
							editor: {
								aspectRatio: "native",
								cropRegion: { x: 0.25, y: 0, width: 0.5, height: 1 },
								wallpaper:
									layer === "background"
										? `${location.origin}/hover-wallpaper.png`
										: layer === "video"
											? `${location.origin}/tests/ui/fixtures/background.webm`
											: "#304060",
								annotationRegions:
									layer === "text"
										? [
												{
													id: "later-text",
													type: "text",
													startMs: 1000,
													endMs: 6000,
													content: "Later words",
													position: { x: 50, y: 50 },
													size: { width: 60, height: 25 },
													style: {
														fontFamily: '"DM Sans"',
														fontStyle: "italic",
													},
													zIndex: 1,
												},
											]
										: layer === "annotation"
											? [
													{
														id: "delayed-image",
														type: "image",
														startMs: 1000,
														endMs: 6000,
														content:
															"data:image/svg+xml," +
															encodeURIComponent(
																'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect id="hover-annotation" width="64" height="64" fill="#ff3200"/></svg>',
															),
														position: { x: 50, y: 50 },
														size: { width: 35, height: 35 },
														zIndex: 1,
													},
												]
											: [],
								webcam: {
									enabled: layer === "webcam",
									sourcePath:
										layer === "webcam" ? "/recordings/camera.mp4" : null,
								},
								autoCaptions: [
									{ id: "cue", startMs: 0, endMs: 6000, text: "Ready together" },
								],
								autoCaptionSettings: {
									enabled: layer === "caption",
									style: "tiktok",
									animationStyle: "none",
								},
								clipRegions: [
									{
										id: "clip",
										startMs: 0,
										endMs: 6000,
										sourceStartMs: 0,
										speed: 1,
									},
								],
							},
						},
					},
				};
			};
		},
		layer,
	);
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const card = page.getByRole("button", { name: "Complete scene", exact: true });
	await expect(card).toBeVisible({ timeout: 25000 });
	return card;
}

async function sampleLoadingFrames(page: Page, milliseconds = 900) {
	return page.evaluate(async (milliseconds) => {
		let frames = 0;
		let exposedFrames = 0;
		const end = performance.now() + milliseconds;
		await new Promise<void>((resolve) => {
			function sample() {
				frames++;
				for (const element of document.querySelectorAll<HTMLElement>(
					"[data-project-hover-preview]",
				)) {
					const style = getComputedStyle(element);
					if (Number(style.opacity) > 0 && style.visibility !== "hidden") exposedFrames++;
				}
				if (performance.now() >= end) resolve();
				else requestAnimationFrame(sample);
			}
			requestAnimationFrame(sample);
		});
		return { frames, exposedFrames };
	}, milliseconds);
}

for (const layer of ["webcam", "background", "caption", "text"] as const) {
	test(`hover keeps its thumbnail for every frame while ${layer} loads, including reentry`, async ({
		page,
	}) => {
		let release!: () => void;
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		let requested = false;
		const resource =
			layer === "webcam"
				? "**/hover-camera.mp4"
				: layer === "background"
					? "**/hover-wallpaper.png"
					: layer === "text"
						? /DMSans-Italic-Variable\.ttf(?:\?.*)?$/
						: /TikTokSans-Variable\.ttf(?:\?.*)?$/;
		const fontLayer = layer === "caption" || layer === "text";
		await page.route(resource, async (route) => {
			if (fontLayer && route.request().resourceType() !== "font") {
				await route.continue();
				return;
			}
			requested = true;
			await pending;
			if (fontLayer) await route.continue();
			else
				await route.fulfill({
					path:
						layer === "webcam"
							? "tests/ui/fixtures/preview.mp4"
							: "tests/ui/fixtures/recording-thumbnail.jpg",
					contentType: layer === "webcam" ? "video/mp4" : "image/jpeg",
				});
		});
		try {
			const card = await openProject(page, layer);
			await card.hover();
			const hover = card.locator("[data-project-hover-preview]");
			await expect(hover).toHaveCount(1);
			await expect.poll(() => requested).toBe(true);
			if (layer === "text")
				await expect(hover.locator('[data-annotation-id="later-text"]')).toHaveCount(0);
			await expect
				.poll(() =>
					hover
						.locator('video[src$="/filmstrip.mp4"]')
						.evaluate((video: HTMLVideoElement) => video.readyState),
				)
				.toBeGreaterThanOrEqual(2);
			const first = await sampleLoadingFrames(page);
			expect(first.frames).toBeGreaterThan(8);
			expect(first.exposedFrames).toBe(0);
			await expect(card.locator('img[src*="recording-thumbnail.jpg"]')).toBeVisible();
			await page.mouse.move(0, 0);
			await expect(hover).toHaveCount(0);
			await card.hover();
			await expect(hover).toHaveCount(1);
			const reentry = await sampleLoadingFrames(page, 400);
			expect(reentry.exposedFrames).toBe(0);
			release();
			await expect(hover).toHaveCSS("opacity", "1", { timeout: 15000 });
			if (layer === "caption") await expect(hover.getByText("Ready together")).toBeVisible();
			if (layer === "text") {
				await expect(hover.getByText("Later words")).toBeVisible();
				const frames = await sampleLoadingFrames(page, 500);
				expect(frames.exposedFrames).toBe(frames.frames);
			}
			if (layer === "webcam")
				await expect(hover.locator("[data-webcam-overlay]")).toHaveAttribute(
					"data-webcam-ready",
					"true",
				);
			const ratio = await hover
				.locator("[data-preview-captions-ready]")
				.evaluate((element) => element.clientWidth / element.clientHeight);
			expect(ratio).toBeCloseTo(8 / 9, 1);
			await hover.screenshot({ path: test.info().outputPath(`${layer}-complete.png`) });
		} finally {
			release();
		}
	});
}

test("unrelated document font loading cannot hide or seek an established hover", async ({
	page,
}) => {
	let release!: () => void;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	let requested = false;
	await page.route("**/unrelated-hover-font.ttf", async (route) => {
		requested = true;
		await pending;
		await route.fulfill({
			path: "src/assets/fonts/dm-sans/DMSans-Italic-Variable.ttf",
			contentType: "font/ttf",
		});
	});
	try {
		const card = await openProject(page, "video");
		await card.hover();
		const hover = card.locator("[data-project-hover-preview]");
		await expect(hover).toHaveCSS("opacity", "1", { timeout: 15000 });
		await hover.evaluate((element) => {
			const video = element.querySelector<HTMLVideoElement>('video[src$="/filmstrip.mp4"]')!;
			element.dataset.unrelatedFontSeeks = "0";
			video.addEventListener("seeking", () => {
				element.dataset.unrelatedFontSeeks = String(
					Number(element.dataset.unrelatedFontSeeks) + 1,
				);
			});
			const face = new FontFace(
				"Unrelated hover font",
				`url("${location.origin}/unrelated-hover-font.ttf")`,
			);
			document.fonts.add(face);
			void face.load();
		});
		await expect.poll(() => requested).toBe(true);
		await expect.poll(() => page.evaluate(() => document.fonts.status)).toBe("loading");
		const loading = await sampleLoadingFrames(page, 600);
		expect(loading.frames).toBeGreaterThan(8);
		expect(loading.exposedFrames).toBe(loading.frames);
		release();
		await expect.poll(() => page.evaluate(() => document.fonts.status)).toBe("loaded");
		const loaded = await sampleLoadingFrames(page, 400);
		expect(loaded.exposedFrames).toBe(loaded.frames);
		await expect(hover).toHaveAttribute("data-unrelated-font-seeks", "0");
	} finally {
		release();
	}
});

test("missing composed media falls back to the static thumbnail", async ({ page }) => {
	let abort!: () => void;
	const pending = new Promise<void>((resolve) => {
		abort = resolve;
	});
	await page.route("**/hover-camera.mp4", async (route) => {
		await pending;
		await route.abort("failed");
	});
	const card = await openProject(page, "webcam");
	await card.hover();
	await expect(card.locator("[data-project-hover-preview]")).toHaveCount(1);
	abort();
	await expect(card.locator("[data-project-hover-preview]")).toHaveCount(0, { timeout: 10000 });
	await expect(card.locator('img[src*="recording-thumbnail.jpg"]')).toBeVisible();
});

test("an old hover's rejected play promise cannot remove its replacement", async ({ page }) => {
	await page.addInitScript(() => {
		const play = HTMLMediaElement.prototype.play;
		let intercepted = false;
		HTMLMediaElement.prototype.play = function () {
			if (
				!intercepted &&
				this instanceof HTMLVideoElement &&
				this.closest("[data-project-hover-preview]") &&
				this.src.endsWith("/filmstrip.mp4")
			) {
				intercepted = true;
				return new Promise<void>((_resolve, reject) => {
					Object.assign(window, {
						rejectOldHoverPlay: () =>
							reject(new DOMException("Old hover disposed", "AbortError")),
					});
					document.documentElement.dataset.oldHoverPlayPending = "true";
				});
			}
			return play.call(this);
		};
	});
	const card = await openProject(page, "background");
	await page.route("**/hover-wallpaper.png", (route) =>
		route.fulfill({
			path: "tests/ui/fixtures/recording-thumbnail.jpg",
			contentType: "image/jpeg",
		}),
	);
	await card.hover();
	const hover = card.locator("[data-project-hover-preview]");
	await expect(page.locator("html")).toHaveAttribute("data-old-hover-play-pending", "true", {
		timeout: 15000,
	});
	await page.mouse.move(0, 0);
	await expect(hover).toHaveCount(0);
	await card.hover();
	await expect(hover).toHaveCSS("opacity", "1", { timeout: 15000 });
	await page.evaluate(() =>
		(window as unknown as { rejectOldHoverPlay(): void }).rejectOldHoverPlay(),
	);
	const frames = await sampleLoadingFrames(page, 400);
	expect(frames.exposedFrames).toBe(frames.frames);
	await expect(hover).toHaveCount(1);
});

test("video wallpaper stays composed through seeks and a loop", async ({ page }) => {
	const card = await openProject(page, "video");
	await card.hover();
	const hover = card.locator("[data-project-hover-preview]");
	await expect(hover).toHaveCSS("opacity", "1", { timeout: 15000 });
	const results = await hover.evaluate(async (element) => {
		const background = element.querySelector<HTMLVideoElement>(
			"video[data-preview-background]",
		)!;
		let hidden = 0;
		let sampled = 0;
		let seeks = 0;
		background.addEventListener("seeking", () => {
			seeks++;
		});
		background.currentTime = Math.max(0, background.duration - 0.1);
		await background.play();
		const end = performance.now() + 1200;
		await new Promise<void>((resolve) => {
			function sample() {
				sampled++;
				const style = getComputedStyle(element);
				if (style.visibility === "hidden" || Number(style.opacity) === 0) hidden++;
				if (performance.now() < end) requestAnimationFrame(sample);
				else resolve();
			}
			requestAnimationFrame(sample);
		});
		return { hidden, sampled, seeks };
	});
	expect(results.seeks).toBeGreaterThan(0);
	expect(results.sampled).toBeGreaterThan(8);
	expect(results.hidden).toBe(0);
});

test("async project metadata keeps its thumbnail through leave and reentry", async ({ page }) => {
	const card = await openProject(page, "metadata");
	await card.hover();
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					typeof (window as unknown as { releaseHoverMetadata?: unknown })
						.releaseHoverMetadata,
			),
		)
		.toBe("function");
	expect((await sampleLoadingFrames(page)).exposedFrames).toBe(0);
	await page.mouse.move(0, 0);
	await card.hover();
	expect((await sampleLoadingFrames(page, 400)).exposedFrames).toBe(0);
	await page.evaluate(() =>
		(window as unknown as { releaseHoverMetadata(): void }).releaseHoverMetadata(),
	);
	await expect(card.locator("[data-project-hover-preview]")).toHaveCSS("opacity", "1", {
		timeout: 15000,
	});
});

test("future image annotation decodes before any hover frame, without a late pop or reentry race", async ({
	page,
}) => {
	await page.addInitScript(() => {
		const decode = HTMLImageElement.prototype.decode;
		let release!: () => void;
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		Object.assign(window, { releaseHoverAnnotation: release });
		HTMLImageElement.prototype.decode = function () {
			const decoded = decode.call(this);
			if (!this.src.includes("hover-annotation")) return decoded;
			return decoded.then(() => {
				document.documentElement.dataset.annotationDecodePending = "true";
				return pending;
			});
		};
	});
	const card = await openProject(page, "annotation");
	await card.hover();
	const hover = card.locator("[data-project-hover-preview]");
	await expect(hover).toHaveCount(1);
	await expect(page.locator("html")).toHaveAttribute("data-annotation-decode-pending", "true", {
		timeout: 15000,
	});
	// This saved image enters at 1s: it is not mounted at the paused opening frame.
	await expect(hover.locator('[data-annotation-id="delayed-image"]')).toHaveCount(0);
	expect((await sampleLoadingFrames(page)).exposedFrames).toBe(0);
	await page.mouse.move(0, 0);
	await expect(hover).toHaveCount(0);
	await card.hover();
	await expect(hover).toHaveCount(1);
	expect((await sampleLoadingFrames(page, 400)).exposedFrames).toBe(0);
	await page.evaluate(() =>
		(window as unknown as { releaseHoverAnnotation(): void }).releaseHoverAnnotation(),
	);
	await expect(hover).toHaveCSS("opacity", "1", { timeout: 15000 });
	const drawnFrames = await sampleLoadingFrames(page, 1800);
	expect(drawnFrames.exposedFrames).toBe(drawnFrames.frames);
	const image = hover.locator('[data-annotation-id="delayed-image"] img');
	await expect(image).toBeVisible();
	expect(
		await image.evaluate(
			(element: HTMLImageElement) => element.complete && element.naturalWidth > 0,
		),
	).toBe(true);
	await hover.screenshot({ path: test.info().outputPath("annotation-complete.png") });
});
