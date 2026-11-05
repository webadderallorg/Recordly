import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("project thumbnails show timeline and source durations in the bottom right", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		window.electronAPI.listProjectFiles = async () => ({
			success: true,
			entries: ["Edited", "Long", "Legacy"].map((name) => ({
				path: `/projects/${name}.recordly`,
				name,
				updatedAt: 1,
				thumbnailPath: `${location.origin}/tests/ui/fixtures/recording-thumbnail.jpg`,
				isCurrent: false,
				isInProjectsDirectory: true,
			})),
		});
		window.electronAPI.getProjectPreview = async (path) => ({
			success: true,
			value: {
				videoUrl: `${location.origin}/tests/ui/fixtures/preview.mp4`,
				webcamUrl: null,
				project: {
					version: 1,
					videoPath: "/recordings/preview.mp4",
					editor: {
						clipRegions: path.includes("Legacy")
							? []
							: [
									{
										id: "clip",
										startMs: 0,
										endMs: path.includes("Long") ? 3723000 : 12000,
										sourceStartMs: 0,
										speed: 2,
									},
								],
					},
				},
			},
		});
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const home = page.getByRole("dialog", { name: "Projects dashboard" });
	for (const [name, duration] of [
		["Edited", "0:12"],
		["Long", "1:02:03"],
		["Legacy", "0:06"],
	]) {
		const card = home.getByRole("button", { name, exact: true });
		const badge = card.locator("[data-thumbnail-duration]");
		await expect(badge).toHaveText(duration);
		const placement = await badge.evaluate((element) => {
			const badge = element.getBoundingClientRect();
			const thumbnail = element.parentElement!.getBoundingClientRect();
			return {
				right: thumbnail.right - badge.right,
				bottom: thumbnail.bottom - badge.bottom,
			};
		});
		expect(placement.right).toBeCloseTo(8, 0);
		expect(placement.bottom).toBeCloseTo(8, 0);
	}
	await page.mouse.move(0, 0);
	await page.screenshot({ path: "test-results/thumbnail-durations.png", animations: "disabled" });
});


test("saved local thumbnails use approved HTTP transport without losing capability queries", async ({
	page,
}) => {
	await installDesktopBridge(page);
	const blockedFiles: string[] = [];
	page.on("console", (message) => {
		if (message.text().includes("Not allowed to load local resource"))
			blockedFiles.push(message.text());
	});
	await page.addInitScript(() => {
		const path = "/Users/demo/Projects/Cat #1.recordly.preview.png";
		window.electronAPI.getLocalMediaUrl = async (filePath) => {
			document.documentElement.dataset.thumbnailLocalPath = filePath;
			return {
				success: true,
				url: `${location.origin}/tests/ui/fixtures/recording-thumbnail.jpg?token=fixture-capability`,
			};
		};
		window.electronAPI.listProjectFiles = async () => ({
			success: true,
			entries: [
				{
					path: "/projects/Cat.recordly",
					name: "Native saved thumbnail",
					updatedAt: 123,
					thumbnailPath: path,
					isCurrent: false,
					isInProjectsDirectory: true,
				},
			],
		});
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const image = page
		.getByRole("button", { name: "Native saved thumbnail", exact: true })
		.locator("img");
	await expect(image).toBeVisible();
	await expect
		.poll(() => image.evaluate((image: HTMLImageElement) => image.naturalWidth))
		.toBeGreaterThan(0);
	const src = new URL((await image.getAttribute("src"))!);
	expect(src.protocol).toBe("http:");
	expect(src.searchParams.get("token")).toBe("fixture-capability");
	expect(src.searchParams.get("v")).toBe("123");
	await expect(page.locator("html")).toHaveAttribute(
		"data-thumbnail-local-path",
		"/Users/demo/Projects/Cat #1.recordly.preview.png",
	);
	expect(blockedFiles).toEqual([]);
});

test("projects without usable thumbnails generate their opening frame without hovering", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		window.electronAPI.listProjectFiles = async () => ({
			success: true,
			entries: ["Missing", "Broken", "Existing"].map((name) => ({
				path: `/projects/${name}.recordly`,
				name,
				updatedAt: 1,
				thumbnailPath:
					name === "Missing"
						? null
						: `${location.origin}/tests/ui/fixtures/${name === "Broken" ? "absent.png" : "recording-thumbnail.jpg"}`,
				isCurrent: false,
				isInProjectsDirectory: true,
			})),
		});
		window.electronAPI.getProjectPreview = async (path) => ({
			success: true,
			value: {
				videoUrl: `${location.origin}/tests/ui/fixtures/preview.mp4`,
				webcamUrl: null,
				project: {
					version: 1,
					videoPath: "/recordings/preview.mp4",
					editor: {
						wallpaper: "#ff0000",
						aspectRatio: path.includes("Broken") ? "9:16" : "16:9",
						borderRadius: 0,
						shadowIntensity: 0,
						padding: { top: 40, bottom: 40, left: 40, right: 40, linked: true },
						clipRegions: [
							{
								id: "trimmed",
								startMs: 0,
								endMs: 3000,
								sourceStartMs: 2000,
								speed: 1,
							},
						],
					},
				},
			},
		});
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	await page.mouse.move(0, 0);
	const home = page.getByRole("dialog", { name: "Projects dashboard" });
	for (const name of ["Missing", "Broken"]) {
		const card = home.getByRole("button", { name, exact: true });
		// Thumbnail decoding/rendering has a 15s deadline and shares the GPU work queue.
		await expect(card.locator('img[src^="data:image/png"]')).toBeVisible({ timeout: 20_000 });
		await expect(card.locator("[data-thumbnail-duration]")).toHaveText("0:03");
	}
	for (const name of ["Missing", "Broken"]) {
		const pixels = await home
			.getByRole("button", { name, exact: true })
			.locator("img")
			.evaluate((image: HTMLImageElement) => {
				const canvas = document.createElement("canvas");
				canvas.width = image.naturalWidth;
				canvas.height = image.naturalHeight;
				const context = canvas.getContext("2d")!;
				context.drawImage(image, 0, 0);
				return {
					edges: [
						[10, 10],
						[320, 1],
						[320, 478],
						[1, 240],
						[638, 240],
					].map(([x, y]) => [...context.getImageData(x, y, 1, 1).data]),
					center: [...context.getImageData(320, 240, 1, 1).data],
				};
			});
		// The landscape composition is cropped horizontally to cover the card;
		// its deliberate top/bottom padding remains, without inventing side bars.
		for (const edge of name === "Missing" ? pixels.edges.slice(0, 3) : pixels.edges)
			expect(edge).toEqual([255, 0, 0, 255]);
		if (name === "Missing")
			for (const edge of pixels.edges.slice(3)) expect(edge).not.toEqual([255, 0, 0, 255]);
		expect(pixels.center).not.toEqual([255, 0, 0, 255]);
	}
	await expect(
		home.getByRole("button", { name: "Existing", exact: true }).locator("img"),
	).toHaveAttribute("src", /recording-thumbnail.jpg/);
	await page.screenshot({
		path: "test-results/generated-project-thumbnails.png",
		animations: "disabled",
	});
});

test("native landscape and cropped portrait thumbnails cover the card and keep their composition on hover", async ({
	page,
}) => {
	test.setTimeout(60_000);
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		window.electronAPI.listProjectFiles = async () => ({
			success: true,
			entries: ["Landscape full", "Portrait crop"].map((name) => ({
				path: `/projects/${name}.recordly`,
				name,
				updatedAt: 1,
				thumbnailPath: null,
				isCurrent: false,
				isInProjectsDirectory: true,
			})),
		});
		window.electronAPI.getProjectPreview = async (path) => ({
			success: true,
			value: {
				videoUrl: `${location.origin}/tests/ui/fixtures/preview.mp4`,
				webcamUrl: null,
				project: {
					version: 1,
					videoPath: "/recordings/preview.mp4",
					editor: {
						aspectRatio: "native",
						wallpaper: "#ed13a4",
						padding: 0,
						borderRadius: 0,
						shadowIntensity: 0,
						cropRegion: path.includes("Portrait")
							? { x: 0.25, y: 0, width: 0.5, height: 1 }
							: { x: 0, y: 0, width: 1, height: 1 },
					},
				},
			},
		});
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	await page.mouse.move(0, 0);
	const home = page.getByRole("dialog", { name: "Projects dashboard" });
	for (const name of ["Landscape full", "Portrait crop"]) {
		const card = home.getByRole("button", { name, exact: true });
		const image = card.locator('img[src^="data:image/png"]');
		await expect(image).toBeVisible({ timeout: 20_000 });
		const pixels = await image.evaluate((image: HTMLImageElement) => {
			const canvas = document.createElement("canvas");
			canvas.width = image.naturalWidth;
			canvas.height = image.naturalHeight;
			const context = canvas.getContext("2d")!;
			context.drawImage(image, 0, 0);
			return [
				[320, 2],
				[320, 477],
				[2, 240],
				[637, 240],
			].map(([x, y]) => [...context.getImageData(x, y, 1, 1).data]);
		});
		for (const pixel of pixels) {
			expect(pixel).not.toEqual([237, 19, 164, 255]);
			expect(pixel[3]).toBe(255);
		}
		await card.hover();
		const hover = card.locator("[data-project-hover-preview]");
		await expect(hover).toHaveCSS("opacity", "1", { timeout: 20_000 });
		const dimensions = await hover.evaluate((element) => {
			const card = element.getBoundingClientRect();
			const frame = element.firstElementChild!.firstElementChild!.getBoundingClientRect();
			return {
				cardWidth: card.width,
				cardHeight: card.height,
				width: frame.width,
				height: frame.height,
			};
		});
		expect(dimensions.width + 1).toBeGreaterThanOrEqual(dimensions.cardWidth);
		expect(dimensions.height + 1).toBeGreaterThanOrEqual(dimensions.cardHeight);
		expect(dimensions.width / dimensions.height).toBeCloseTo(
			name.includes("Portrait") ? 8 / 9 : 16 / 9,
			1,
		);
		await page.mouse.move(0, 0);
		await expect(hover).toHaveCount(0);
	}
	await page.screenshot({
		path: "test-results/project-thumbnail-cover.png",
		animations: "disabled",
	});
});

test("generated thumbnails survive scrolling and filtering without another render", async ({
	page,
}) => {
	// Generate real previews before exercising scrolling and filter remounts.
	test.setTimeout(60_000);
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		const writes: Record<string, number> = {};
		window.electronAPI.cacheProjectThumbnail = async (path) => {
			writes[path] = (writes[path] ?? 0) + 1;
			document.documentElement.dataset.thumbnailWrites = JSON.stringify(writes);
			return { success: true, value: `${path}.png` };
		};
		window.electronAPI.listProjectFiles = async () => ({
			success: true,
			entries: Array.from({ length: 32 }, (_, index) => ({
				path: `/projects/scroll-${index}.recordly`,
				name: `Scroll project ${index}`,
				updatedAt: 1,
				thumbnailPath: null,
				isCurrent: false,
				isInProjectsDirectory: true,
			})),
		});
		window.electronAPI.getProjectPreview = async () => ({
			success: true,
			value: {
				revision: "fixture-revision",
				videoUrl: `${location.origin}/tests/ui/fixtures/preview.mp4`,
				webcamUrl: null,
				project: {
					version: 1,
					videoPath: "/recordings/preview.mp4",
					editor: {
						wallpaper: "#ff0000",
						padding: { top: 40, bottom: 40, left: 40, right: 40, linked: true },
					},
				},
			},
		});
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	await page.mouse.move(0, 0);
	const home = page.getByRole("dialog", { name: "Projects dashboard" });
	const first = home.getByRole("button", { name: "Scroll project 0", exact: true });
	const image = first.locator('img[src^="data:image/png"]');
	// Wait for real queued generation before testing reuse across scrolling/remounts.
	await expect(image).toBeVisible({ timeout: 20_000 });
	const source = await image.getAttribute("src");
	const scroller = home.locator("main");
	await scroller.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	await expect
		.poll(() => first.evaluate((element) => element.getBoundingClientRect().bottom))
		.toBeLessThan(-800);
	// Moving outside the prefetch region must not clear the completed image.
	await expect(image).toHaveAttribute("src", source!);
	await scroller.evaluate((element) => {
		element.scrollTop = 0;
	});
	await expect(image).toBeVisible();
	await expect(image).toHaveAttribute("src", source!);
	const search = home.getByPlaceholder("Search projects…");
	await search.fill("Scroll project 31");
	await expect(first).toHaveCount(0);
	await search.clear();
	await expect(image).toBeVisible();
	await expect(image).toHaveAttribute("src", source!);
	await expect
		.poll(async () => {
			const writes = JSON.parse(
				(await page.locator("html").getAttribute("data-thumbnail-writes")) ?? "{}",
			);
			return writes["/projects/scroll-0.recordly"];
		})
		.toBe(1);
});

test("project posters include the recorded cursor and honor the saved visibility setting", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		window.electronAPI.listProjectFiles = async () => ({
			success: true,
			entries: ["Cursor visible", "Cursor hidden"].map((name) => ({
				path: `/projects/${name}.recordly`,
				name,
				updatedAt: 1,
				thumbnailPath: null,
				isCurrent: false,
				isInProjectsDirectory: true,
			})),
		});
		window.electronAPI.getCursorTelemetry = async (path) => {
			document.documentElement.dataset.cursorSource = path;
			return {
				success: true,
				samples: [
					{ timeMs: 0, cx: 0.5, cy: 0.5, interactionType: "move" },
					{ timeMs: 6000, cx: 0.5, cy: 0.5, interactionType: "move" },
				],
			};
		};
		window.electronAPI.getProjectPreview = async (path) => ({
			success: true,
			value: {
				videoUrl: `${location.origin}/tests/ui/fixtures/preview.mp4`,
				webcamUrl: null,
				project: {
					version: 1,
					videoPath: "/recordings/cursor-source.mp4",
					editor: {
						aspectRatio: "4:3",
						padding: 0,
						borderRadius: 0,
						shadowIntensity: 0,
						showCursor: path.includes("visible"),
						cursorStyle: "tahoe",
						cursorSize: 5,
					},
				},
			},
		});
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	await page.mouse.move(0, 0);
	const home = page.getByRole("dialog", { name: "Projects dashboard" });
	const visible = home
		.getByRole("button", { name: "Cursor visible", exact: true })
		.locator('img[src^="data:image/png"]');
	const hidden = home
		.getByRole("button", { name: "Cursor hidden", exact: true })
		.locator('img[src^="data:image/png"]');
	await expect(visible).toBeVisible({ timeout: 20_000 });
	await expect(hidden).toBeVisible({ timeout: 20_000 });
	await expect(page.locator("html")).toHaveAttribute(
		"data-cursor-source",
		"/recordings/cursor-source.mp4",
	);
	const difference = await page.evaluate(
		async ([withCursor, withoutCursor]) => {
			const read = async (src: string) => {
				const image = new Image();
				image.src = src;
				await image.decode();
				const canvas = document.createElement("canvas");
				canvas.width = 640;
				canvas.height = 480;
				const context = canvas.getContext("2d")!;
				context.drawImage(image, 0, 0);
				return context.getImageData(0, 0, 640, 480).data;
			};
			const [a, b] = await Promise.all([read(withCursor), read(withoutCursor)]);
			let nearCursor = 0,
				elsewhere = 0;
			for (let y = 0; y < 480; y++)
				for (let x = 0; x < 640; x++) {
					const i = (y * 640 + x) * 4;
					if (
						Math.abs(a[i] - b[i]) +
							Math.abs(a[i + 1] - b[i + 1]) +
							Math.abs(a[i + 2] - b[i + 2]) <
						30
					)
						continue;
					if (x >= 270 && x < 420 && y >= 190 && y < 340) nearCursor++;
					else elsewhere++;
				}
			return { nearCursor, elsewhere };
		},
		[(await visible.getAttribute("src"))!, (await hidden.getAttribute("src"))!],
	);
	expect(difference.nearCursor).toBeGreaterThan(30);
	expect(difference.elsewhere).toBeLessThan(10);
	await home.screenshot({
		path: "test-results/project-thumbnail-cursor.png",
		animations: "disabled",
	});
});
