import { expect, test } from "@playwright/test";
import type {} from "./blur-seeking";
import { installDesktopBridge } from "./bridge";

test("both export renderers blur the recording silhouette before encoding", async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/tests/ui/blur-seeking.html");
	const results = await page.evaluate(async () => {
		const results = [];
		const source = document.createElement("canvas");
		source.width = 640;
		source.height = 360;
		const context = source.getContext("2d")!;
		context.fillStyle = "white";
		context.fillRect(0, 0, 640, 360);
		for (const name of ["modernFrameRenderer", "frameRenderer"]) {
			const { FrameRenderer } = await import(`/src/lib/exporter/${name}.ts`);
			const renderer = new FrameRenderer({
				width: 640,
				height: 360,
				videoWidth: 640,
				videoHeight: 360,
				wallpaper: "#111111",
				showShadow: false,
				shadowIntensity: 0,
				backgroundBlur: 0,
				zoomMotionBlur: 1,
				zoomClassicMode: true,
				padding: 100,
				borderRadius: 12,
				showCursor: false,
				cropRegion: { x: 0, y: 0, width: 1, height: 1 },
				zoomRegions: [
					{
						id: "zoom",
						startMs: 0,
						endMs: 2000,
						depth: 2,
						focus: { cx: 0.5, cy: 0.5 },
						mode: "manual",
					},
				],
				preferredRenderBackend: "webgl",
			});
			await renderer.initialize();
			const frame = new VideoFrame(source, { timestamp: 0 });
			try {
				for (let i = 0; i <= 12; i++)
					await renderer.renderFrame(frame, Math.round((i * 1_000_000) / 60));
				const sample = () => {
					const sprite = renderer.scene?.videoSprite ?? renderer.videoSprite;
					const bounds = sprite.getBounds();
					const copy = document.createElement("canvas");
					copy.width = 640;
					copy.height = 360;
					const context = copy.getContext("2d")!;
					context.drawImage(renderer.getCanvas(), 0, 0);
					const { data } = context.getImageData(0, 0, 640, 360);
					let outside = 0;
					for (const edge of [bounds.x, bounds.x + bounds.width]) {
						const direction = edge === bounds.x ? -1 : 1;
						for (let offset = 3; offset <= 12; offset++) {
							const x = Math.round(edge + direction * offset);
							for (let row = -5; row <= 5; row++) {
								const y = Math.round(bounds.y + bounds.height / 2 + row);
								if (
									x >= 0 &&
									x < 640 &&
									y >= 0 &&
									y < 360 &&
									data[(y * 640 + x) * 4] > 25
								)
									outside++;
							}
						}
					}
					return outside;
				};
				const blurred = sample();
				renderer.config.zoomMotionBlur = 0;
				await renderer.renderFrame(frame, 200_000);
				results.push({ name, blurred, disabled: sample() });
			} finally {
				frame.close();
				renderer.destroy();
			}
		}
		return results;
	});
	for (const result of results) {
		expect(result.blurred, result.name).toBeGreaterThan(10);
		expect(result.disabled, result.name).toBe(0);
	}
});

test("paused zoom blur softens the recording silhouette beyond its mask", async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/tests/ui/blur-seeking.html?motion&edges");
	await expect
		.poll(() => page.evaluate(() => !!window.blurPreview), { timeout: 60000 })
		.toBe(true);
	await page.evaluate(() => window.blurPreview!.api!.seekTimeline(0.65));
	await expect
		.poll(() => page.evaluate(() => window.blurPreview!.api!.video!.seeking))
		.toBe(false);
	const sample = () =>
		page.evaluate(() => {
			const api = window.blurPreview!.api!;
			const app = api.app!;
			app.render();
			const bounds = api.videoSprite!.getBounds();
			const copy = document.createElement("canvas");
			copy.width = app.canvas.width;
			copy.height = app.canvas.height;
			const context = copy.getContext("2d")!;
			context.drawImage(app.canvas, 0, 0);
			const {
				data: pixels,
				width,
				height,
			} = context.getImageData(0, 0, copy.width, copy.height);
			const resolution = app.renderer.resolution;
			let outside = 0;
			for (const edge of [bounds.x, bounds.x + bounds.width]) {
				const direction = edge === bounds.x ? -1 : 1;
				for (let offset = 3; offset <= 12; offset++) {
					const x = Math.round((edge + direction * offset) * resolution);
					for (let row = -5; row <= 5; row++) {
						const y = Math.round((bounds.y + bounds.height / 2 + row) * resolution);
						if (
							x >= 0 &&
							x < width &&
							y >= 0 &&
							y < height &&
							pixels[(y * width + x) * 4 + 3] > 2
						)
							outside++;
					}
				}
			}
			return { outside, time: api.video!.currentTime, visible: api.videoSprite!.visible };
		});
	await expect.poll(async () => (await sample()).outside).toBeGreaterThan(10);
	expect((await sample()).visible).toBe(true);
	await page.screenshot({
		path: test.info().outputPath("motion-blur-edges.png"),
		clip: { x: 0, y: 0, width: 900, height: 510 },
	});
});

for (const solid of [false, true]) {
	test(`seeking holds the last composed ${solid ? "redacted " : ""}frame instead of flashing the background`, async ({
		page,
	}) => {
		await installDesktopBridge(page, "filmstrip.mp4");
		await page.goto(`/tests/ui/blur-seeking.html${solid ? "?solid&crop" : ""}`);
		await expect
			.poll(() => page.evaluate(() => !!window.blurPreview), { timeout: 60000 })
			.toBe(true);
		const samples = await page.evaluate(async () => {
			const api = window.blurPreview!.api!;
			const video = api.video!;
			const app = api.app!;
			const tick = () =>
				new Promise<void>((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
				);
			await tick();
			const samples = [];
			for (const time of [1.2, 3.1, 5.2, 0.7]) {
				app.render();
				const before = app.canvas.toDataURL();
				api.seekTimeline(time);
				app.render();
				samples.push({
					seeking: video.seeking,
					visible: api.videoSprite!.visible,
					held: app.canvas.toDataURL() === before,
				});
				if (video.seeking)
					await new Promise<void>((resolve) =>
						video.addEventListener("seeked", () => resolve(), { once: true }),
					);
				await tick();
			}
			return samples;
		});
		expect(samples).toHaveLength(4);
		for (const sample of samples) {
			expect(sample.seeking).toBe(true);
			expect(sample.visible).toBe(true);
			expect(sample.held).toBe(true);
		}
	});
}

test("privacy edits invalidate a held seek frame until the new mask is composed", async ({
	page,
}) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/tests/ui/blur-seeking.html?solid");
	await expect
		.poll(() => page.evaluate(() => !!window.blurPreview), { timeout: 60000 })
		.toBe(true);
	const region = page.locator('[data-annotation-id="blur"]');
	await region.click();
	await page.evaluate(() => {
		const video = window.blurPreview!.api!.video!;
		// Hold the decoder pending while exercising an actual annotation edit.
		Object.defineProperty(video, "seeking", { configurable: true, get: () => true });
		video.dispatchEvent(new Event("seeking"));
	});
	const box = (await region.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 15, { steps: 4 });
	await page.mouse.up();
	await expect
		.poll(() => page.evaluate(() => window.blurPreview!.api!.videoSprite!.visible))
		.toBe(false);
	await page.evaluate(() => {
		const video = window.blurPreview!.api!.video!;
		Reflect.deleteProperty(video, "seeking");
		video.dispatchEvent(new Event("seeked"));
	});
	await expect
		.poll(() => page.evaluate(() => window.blurPreview!.api!.videoSprite!.visible))
		.toBe(true);
	const sample = await page.evaluate(() => window.blurPreview!.samplePrivacy());
	expect(sample.sourceIsCanvas).toBe(true);
	expect(Math.max(...sample.pixel.slice(0, 3))).toBeLessThan(5);
});

test("paused source redaction includes the end boundary and restores raw video immediately after", async ({
	page,
}) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/tests/ui/blur-seeking.html?solid&crop");
	await expect
		.poll(() => page.evaluate(() => !!window.blurPreview), { timeout: 60000 })
		.toBe(true);
	const video = page.locator("video").first();
	const sampleAt = async (time: number) => {
		await page.evaluate((time) => window.blurPreview!.api!.seekTimeline(time), time);
		await expect
			.poll(() => video.evaluate((video: HTMLVideoElement) => video.seeking))
			.toBe(false);
		return page.evaluate(() => window.blurPreview!.samplePrivacy());
	};
	const active = await sampleAt(4.5);
	expect(active.sourceIsCanvas).toBe(true);
	expect(Math.max(...active.pixel.slice(0, 3))).toBeLessThan(5);
	expect(active.pixel[3]).toBe(255);
	await expect(page.locator('[data-annotation-id="blur"]')).toHaveCount(1);
	const inactive = await sampleAt(4.51);
	expect(inactive.sourceIsCanvas).toBe(false);
	expect(Math.max(...inactive.raw.slice(0, 3))).toBeGreaterThan(80);
	for (let channel = 0; channel < 3; channel++) {
		expect(Math.abs(inactive.pixel[channel] - inactive.raw[channel])).toBeLessThan(20);
	}
	await expect(page.locator('[data-annotation-id="blur"]')).toHaveCount(0);
	const restored = await sampleAt(4.5);
	expect(restored.pixel).toEqual(active.pixel);
	expect(restored.sourceIsCanvas).toBe(true);
});

for (const crop of [false, true]) {
	test(`moving ${crop ? "cropped " : ""}frames redact video pixels before camera motion filters`, async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await installDesktopBridge(page, "filmstrip.mp4");
		await page.goto(`/tests/ui/blur-seeking.html?solid&motion${crop ? "&crop" : ""}`);
		await expect
			.poll(() => page.evaluate(() => !!window.blurPreview), { timeout: 60000 })
			.toBe(true);
		await page.getByRole("button", { name: "Play", exact: true }).click();
		await expect
			.poll(() => page.evaluate(() => window.blurPreview!.probe.privateFrames))
			.toBeGreaterThan(50);
		await page.getByRole("button", { name: "Pause", exact: true }).click();
		const probe = await page.evaluate(() => window.blurPreview!.probe);
		// These are actual Pixi canvas pixels; the DOM coverage pass cannot hide a failure.
		expect(probe.maxRawControl).toBeGreaterThan(80);
		expect(probe.motionFrames).toBeGreaterThan(5);
		expect(probe.maxPrivatePixel).toBeLessThan(20);
		expect(probe.minPrivateAlpha).toBeGreaterThan(250);
		expect(probe.maxError, probe.detail).toBeLessThan(1);
		expect(errors).toEqual([]);
	});
}

for (const crop of [false, true]) {
	test(`blur stays aligned with the rendered camera on every ${crop ? "cropped " : ""}zoom frame`, async ({
		page,
	}) => {
		await installDesktopBridge(page, "filmstrip.mp4");
		await page.goto(`/tests/ui/blur-seeking.html${crop ? "?crop" : ""}`);
		await expect(page.locator("main")).toHaveAttribute("data-ready", "true");
		await expect
			.poll(() => page.evaluate(() => !!window.blurPreview), { timeout: 60000 })
			.toBe(true);
		await page.getByRole("button", { name: "Play", exact: true }).click();
		await expect
			.poll(() => page.evaluate(() => window.blurPreview!.probe.frames))
			.toBeGreaterThan(50);
		await page.getByRole("button", { name: "Pause", exact: true }).click();
		const probe = await page.evaluate(() => window.blurPreview!.probe);
		expect(probe.maxError, probe.detail).toBeLessThan(1);
		await expect(
			page.locator('[data-annotation-id="blur"] [style*="backdrop-filter"]'),
		).toHaveCSS("border-radius", "0px");
	});
}

test("rapid paused seeks render the final frame and its blur visibility consistently", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/tests/ui/blur-seeking.html");
	await expect(page.locator("main")).toHaveAttribute("data-ready", "true");
	await expect
		.poll(() => page.evaluate(() => !!window.blurPreview), { timeout: 60000 })
		.toBe(true);
	const video = page.locator("video").first();
	const canvas = page.locator("canvas").first();
	const seek = async (time: number) => {
		await page.evaluate((time) => window.blurPreview!.api!.seekTimeline(time), time);
		await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.seeking)).toBe(false);
		await expect
			.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
			.toBeCloseTo(time, 4);
	};
	await seek(1.2);
	const snapshot = await canvas.screenshot();
	await page.evaluate(() => {
		const api = window.blurPreview!.api!;
		for (const time of [5.2, 0.7, 3.1, 5.7, 1.2]) api.seekTimeline(time);
	});
	await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.seeking)).toBe(false);
	await expect.poll(async () => (await canvas.screenshot()).equals(snapshot)).toBe(true);
	await expect(page.locator('[data-annotation-id="blur"]')).toHaveCount(1);
	await seek(5.2);
	await expect(page.locator('[data-annotation-id="blur"]')).toHaveCount(0);
	expect((await canvas.screenshot()).equals(snapshot)).toBe(false);
	await seek(1.2);
	await expect.poll(async () => (await canvas.screenshot()).equals(snapshot)).toBe(true);
	expect(errors).toEqual([]);
});

test("seeking between repeated source frames recomposes the timeline camera without a decoder seek", async ({
	page,
}) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/tests/ui/blur-seeking.html?repeat");
	await expect
		.poll(() => page.evaluate(() => !!window.blurPreview), { timeout: 60000 })
		.toBe(true);
	const video = page.locator("video").first();
	const canvas = page.locator("canvas").first();
	const seek = async (time: number) => {
		await page.evaluate((time) => window.blurPreview!.api!.seekTimeline(time), time);
		await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.seeking)).toBe(false);
	};
	await seek(2.2);
	const zoomed = await canvas.screenshot();
	await video.evaluate((v) => {
		v.dataset.seekCount = "0";
		v.addEventListener("seeking", () => {
			v.dataset.seekCount = String(Number(v.dataset.seekCount) + 1);
		});
	});
	await seek(5.2);
	await expect.poll(async () => (await canvas.screenshot()).equals(zoomed)).toBe(false);
	await expect(page.locator('[data-annotation-id="blur"]')).toHaveCount(0);
	await expect(video).toHaveAttribute("data-seek-count", "0");
	await seek(2.2);
	await expect.poll(async () => (await canvas.screenshot()).equals(zoomed)).toBe(true);
	await expect(video).toHaveAttribute("data-seek-count", "0");
});

test("zoomed blur samples scene pixels, remains editable, and exports square corners", async ({
	page,
}) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/tests/ui/blur-seeking.html?autoZoom");
	await expect
		.poll(() => page.evaluate(() => !!window.blurPreview), { timeout: 60000 })
		.toBe(true);
	await page.getByRole("button", { name: "Play", exact: true }).click();
	await expect
		.poll(() =>
			page
				.locator("video")
				.first()
				.evaluate((video: HTMLVideoElement) => video.currentTime),
		)
		.toBeGreaterThan(2.2);
	await page.getByRole("button", { name: "Pause", exact: true }).click();
	const cameraPose = () =>
		page.evaluate(() => {
			const api = window.blurPreview!.api!;
			const camera = api.videoContainer!.parent!.parent!;
			return {
				x: camera.x,
				y: camera.y,
				scale: camera.scale.x,
				width: api.app!.screen.width,
			};
		});
	const cameraBefore = await cameraPose();
	expect(
		Math.abs(cameraBefore.x + (cameraBefore.width / 2) * (cameraBefore.scale - 1)),
	).toBeGreaterThan(20);
	const region = page.locator('[data-annotation-id="blur"]');
	const content = region.locator('[style*="backdrop-filter"]');
	const box = (await region.boundingBox())!;
	const clip = { x: box.x + 2, y: box.y + 2, width: box.width - 4, height: box.height - 4 };
	const blurred = await page.screenshot({ clip });
	const filter = await content.evaluate((el: HTMLElement) => {
		const filter = el.style.backdropFilter;
		el.style.backdropFilter = "none";
		return filter;
	});
	expect(await page.screenshot({ clip })).not.toEqual(blurred);
	await content.evaluate((el: HTMLElement, filter) => {
		el.style.backdropFilter = filter;
	}, filter);
	await region.click();
	const before = (await region.boundingBox())!;
	await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
	await page.mouse.down();
	await page.mouse.move(before.x + before.width / 2 + 40, before.y + before.height / 2 + 20, {
		steps: 8,
	});
	await page.mouse.up();
	await expect.poll(async () => (await region.boundingBox())!.x - before.x).toBeCloseTo(40, 0);
	await expect.poll(async () => (await region.boundingBox())!.y - before.y).toBeCloseTo(20, 0);
	// Dragging a privacy region must not recenter the paused cursor-follow camera.
	expect(await cameraPose()).toEqual(cameraBefore);
	await page.screenshot({ path: test.info().outputPath("blur-preview-zoomed.png") });
	const corner = await page.evaluate(() => window.blurPreview!.exportCorner());
	expect(corner.before).toBe(0);
	expect(corner.after).toBeGreaterThan(80);
});
