import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("the camera reaches the incoming framing when preview frames are delayed", async ({
	page,
}) => {
	test.setTimeout(60000);
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/tests/ui/paused-motion.html?pan&slowCamera");
	const main = page.locator("main");
	const video = page.locator("video").first();
	await expect(main).toHaveAttribute("data-ready", "true");
	await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.seeking)).toBe(false);
	const offset = async () => {
		await page.getByRole("button", { name: "Read camera", exact: true }).click();
		return Number(await main.getAttribute("data-camera-offset"));
	};
	await page.getByRole("button", { name: "Seek incoming start", exact: true }).click();
	await expect.poll(offset, { timeout: 10000 }).toBeLessThan(-20);
	const incoming = await offset();
	await page.getByRole("button", { name: "Seek outgoing end", exact: true }).click();
	await expect.poll(offset, { timeout: 10000 }).toBeGreaterThan(20);
	await page.getByRole("button", { name: "Resume through zoom-out", exact: true }).click();
	await expect
		.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 15000 })
		.toBeGreaterThanOrEqual(3.85);
	await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
	const actual = await offset();
	expect(Math.abs(actual - incoming)).toBeLessThan(5);
	await test.info().attach("delayed-preview-arrival.json", {
		body: JSON.stringify({
			incoming,
			actual,
			frames: JSON.parse((await main.getAttribute("data-pan-samples"))!),
		}),
		contentType: "application/json",
	});
});

test("a short second connected 1.8x block arrives before its full exit", async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/tests/ui/paused-motion.html?pan&shortPan&visualBounds");
	const main = page.locator("main");
	const video = page.locator("video").first();
	await expect(main).toHaveAttribute("data-ready", "true");
	await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.seeking)).toBe(false);
	const scale = async () => {
		await page.getByRole("button", { name: "Read camera", exact: true }).click();
		return Number(await main.getAttribute("data-camera-scale"));
	};
	await page.getByRole("button", { name: "Seek incoming start", exact: true }).click();
	await expect.poll(scale).toBeCloseTo(1.8, 5);
	const zoom = page.locator('[data-variant="zoom"]').last();
	const visibleEnd = Number(await zoom.getAttribute("data-end-ms"));
	const storedEnd = Number(await zoom.getAttribute("data-stored-end-ms"));
	expect(visibleEnd).toBeGreaterThan(3400);
	expect(storedEnd).toBe(3695);
	await page.getByRole("button", { name: "Seek outgoing end", exact: true }).click();
	await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.seeking)).toBe(false);
	await page.getByRole("button", { name: "Play across pan", exact: true }).click();
	await expect
		.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
		.toBeGreaterThanOrEqual(2.745);
	await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
	const frames = JSON.parse((await main.getAttribute("data-pan-samples"))!) as Array<{
		time: number;
		scale: number;
	}>;
	const arriving = frames.filter((frame) => frame.time >= 2.65 && frame.time <= 2.75);
	expect(arriving.length).toBeGreaterThan(0);
	expect(Math.max(...arriving.map((frame) => frame.scale))).toBeGreaterThan(1.77);
	await page.getByRole("button", { name: "Resume through zoom-out", exact: true }).click();
	await expect
		.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
		.toBeGreaterThanOrEqual(3.85);
	await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
	await expect.poll(scale).toBe(1);
	const allFrames = JSON.parse((await main.getAttribute("data-pan-samples"))!) as Array<{
		time: number;
		scale: number;
	}>;
	expect(
		allFrames.some((frame) => frame.time > 3.695 && frame.time < 3.799 && frame.scale > 1),
	).toBe(true);
});

for (const preset of ["focused", "smooth"]) {
	test(`${preset} short zoom keeps the configured entrance and exit pace`, async ({ page }) => {
		await installDesktopBridge(page, "filmstrip.mp4");
		const samples: Array<{ entry: number; exit: number }> = [];
		for (const duration of [3000, 1000]) {
			await page.goto(
				`/tests/ui/paused-motion.html?timing&zoomDuration=${duration}${preset === "smooth" ? "&smooth" : ""}`,
			);
			const main = page.locator("main");
			await expect(main).toHaveAttribute("data-ready", "true");
			await expect
				.poll(() =>
					page
						.locator("video")
						.first()
						.evaluate((v: HTMLVideoElement) => v.seeking),
				)
				.toBe(false);
			const scaleAt = async (button: string, time: number) => {
				await page.getByRole("button", { name: button, exact: true }).click();
				const video = page.locator("video").first();
				await expect
					.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
					.toBeCloseTo(time, 3);
				await expect
					.poll(() => video.evaluate((v: HTMLVideoElement) => v.seeking))
					.toBe(false);
				await page.getByRole("button", { name: "Read camera", exact: true }).click();
				return Number(await main.getAttribute("data-camera-scale"));
			};
			samples.push({
				entry: await scaleAt("Seek early entry", 1.1),
				exit: await scaleAt("Seek last exit sample", (1000 + duration - 100) / 1000),
			});
		}
		expect(samples[1].entry).toBeGreaterThan(1);
		expect(samples[1].entry).toBeLessThanOrEqual(samples[0].entry + 0.00001);
		expect(samples[1].exit).toBeGreaterThan(1);
		expect(samples[1].exit).toBeLessThanOrEqual(samples[0].exit + 0.00001);
		await test.info().attach("short-and-long-zoom-pace.json", {
			body: JSON.stringify(samples),
			contentType: "application/json",
		});
	});
}

test("automatic entrance aims at the cursor from its first faint playback frame", async ({
	page,
}) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/tests/ui/paused-motion.html?timing&focusEntry");
	const main = page.locator("main");
	const video = page.locator("video").first();
	await expect(main).toHaveAttribute("data-ready", "true");
	await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.seeking)).toBe(false);
	await page.getByRole("button", { name: "Play to full zoom", exact: true }).click();
	await expect
		.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
		.toBeGreaterThanOrEqual(2);
	await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
	const frames = JSON.parse((await main.getAttribute("data-pan-samples"))!) as Array<{
		time: number;
		offset: number;
		scale: number;
	}>;
	const entrance = frames.filter(
		(frame) => frame.time > 1 && frame.time < 1.4 && frame.scale > 1.000001,
	);
	expect(entrance.length).toBeGreaterThan(4);
	// Normalizing by zoom depth exposes center-first framing even in faint frames.
	const aim = entrance.map((frame) => frame.offset / (frame.scale - 1));
	expect(Math.max(...aim)).toBeLessThan(-100);
	expect(Math.max(...aim) - Math.min(...aim)).toBeLessThan(0.1);
	await test.info().attach("automatic-entrance-camera-poses.json", {
		body: JSON.stringify(entrance),
		contentType: "application/json",
	});
});

for (const panDepth of ["same", "deeper", "wider"]) {
	test(`connected pan ${panDepth} starts in the gap and settles through the incoming block`, async ({
		page,
	}) => {
		await installDesktopBridge(page, "filmstrip.mp4");
		await page.goto(`/tests/ui/paused-motion.html?pan&panDepth=${panDepth}`);
		const main = page.locator("main");
		const video = page.locator("video").first();
		await expect(main).toHaveAttribute("data-ready", "true");
		const readOffset = async () => {
			await page.getByRole("button", { name: "Read camera", exact: true }).click();
			return Number(await main.getAttribute("data-camera-offset"));
		};
		const seek = async (button: string, time: number) => {
			await page.getByRole("button", { name: button, exact: true }).click();
			await expect
				.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
				.toBeCloseTo(time, 2);
			await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.seeking)).toBe(false);
		};
		await expect.poll(readOffset).toBeGreaterThan(20);
		await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.seeking)).toBe(false);
		await seek("Seek outgoing hold", 1.5);
		await expect.poll(readOffset).toBeGreaterThan(20);
		const outgoing = await readOffset();
		const outgoingScale = Number(await main.getAttribute("data-camera-scale"));
		await seek("Seek outgoing end", 1.9);
		await expect.poll(readOffset).toBeCloseTo(outgoing, 1);
		await seek("Seek incoming start", 3);
		await expect.poll(readOffset).toBeLessThan(-20);
		const incoming = await readOffset();
		const incomingScale = Number(await main.getAttribute("data-camera-scale"));
		await seek("Seek pan midpoint", 2.5);
		await expect.poll(readOffset).toBeGreaterThan(incoming);
		expect(await readOffset()).toBeLessThan(outgoing);
		await seek("Seek outgoing end", 1.9);
		await page.getByRole("button", { name: "Play across pan", exact: true }).click();
		await expect
			.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
			.toBeGreaterThanOrEqual(3.05);
		await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
		const arriving = await readOffset();
		// The camera keeps moving after the pan goal reaches the incoming block.
		expect(arriving).toBeGreaterThan(incoming + 0.5);
		await page.getByRole("button", { name: "Play through settling", exact: true }).click();
		await expect
			.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
			.toBeGreaterThanOrEqual(3.8);
		await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
		expect(await readOffset()).toBeLessThan(arriving - 0.5);
		expect(await readOffset()).toBeCloseTo(incoming, 0);
		const frames = JSON.parse((await main.getAttribute("data-pan-samples"))!) as Array<{
			time: number;
			offset: number;
			scale: number;
		}>;
		const before = frames.filter((f) => f.time > 2.9 && f.time < 3);
		const after = frames.filter((f) => f.time >= 3 && f.time < 3.1);
		expect(before.length).toBeGreaterThan(1);
		expect(after.length).toBeGreaterThan(1);
		const crossing = Math.abs(after[0].offset - before.at(-1)!.offset);
		const preceding = Math.abs(before.at(-1)!.offset - before.at(-2)!.offset);
		expect(crossing).toBeLessThan(preceding * 2 + 0.5);
		expect(Math.abs(after.at(-1)!.offset - after[0].offset)).toBeGreaterThan(0.1);
		if (panDepth !== "same") {
			const firstScale = after[0].scale;
			const lastScale = after.at(-1)!.scale;
			if (incomingScale > outgoingScale) {
				expect(lastScale).toBeGreaterThan(firstScale);
				expect(firstScale).toBeLessThan(incomingScale - 0.0001);
			} else {
				expect(lastScale).toBeLessThan(firstScale);
				expect(firstScale).toBeGreaterThan(incomingScale + 0.0001);
			}
			const precedingScale = Math.abs(before.at(-1)!.scale - before.at(-2)!.scale);
			expect(Math.abs(firstScale - before.at(-1)!.scale)).toBeLessThan(
				precedingScale * 2 + 0.0005,
			);
		}
		await test.info().attach("connected-pan-motion", {
			body: JSON.stringify({ panDepth, outgoing, incoming, frames }),
			contentType: "application/json",
		});
	});
}

test("auto-zoom resumes from a paused seek without retaining the old full-zoom focus", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/tests/ui/paused-motion.html?autoZoom");
	const main = page.locator("main");
	const video = page.locator("video").first();
	await expect(main).toHaveAttribute("data-ready", "true");
	await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.seeking)).toBe(false);
	await page.getByRole("button", { name: "Play to full zoom", exact: true }).click();
	await expect
		.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { intervals: [50] })
		.toBeGreaterThanOrEqual(2);
	await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
	const cameraOffset = async () => {
		await page.getByRole("button", { name: "Read camera" }).click();
		return Math.abs(Number(await main.getAttribute("data-camera-offset")));
	};
	// Full zoom followed the cursor to the right before the seek.
	expect(await cameraOffset()).toBeGreaterThan(20);
	await page.getByRole("button", { name: "Seek zoom-out" }).click();
	await expect
		.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
		.toBeCloseTo(3.7, 2);
	await expect.poll(cameraOffset).toBeLessThan(1);
	await page.getByRole("button", { name: "Resume through zoom-out", exact: true }).click();
	await expect
		.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { intervals: [50] })
		.toBeGreaterThanOrEqual(3.85);
	await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
	expect(await video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeLessThan(4);
	expect(await cameraOffset()).toBeLessThan(1);
	expect(errors).toEqual([]);
});

for (const preset of ["focused", "smooth"]) {
	test(`${preset} zoom finishes at its timeline boundary in playback and after seeks`, async ({
		page,
	}) => {
		await installDesktopBridge(page, "filmstrip.mp4");
		await page.goto(
			`/tests/ui/paused-motion.html?timing${preset === "smooth" ? "&smooth" : ""}`,
		);
		const main = page.locator("main");
		const video = page.locator("video").first();
		await expect(main).toHaveAttribute("data-ready", "true");
		const scale = async () => {
			await page.getByRole("button", { name: "Read camera", exact: true }).click();
			return Number(await main.getAttribute("data-camera-scale"));
		};
		for (const [button, expected] of [
			["Seek zoom start", 1],
			["Seek full zoom", 1.5],
			["Seek zoom end", 1],
		] as const) {
			await page.getByRole("button", { name: button, exact: true }).click();
			await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.seeking)).toBe(false);
			await expect.poll(scale).toBeCloseTo(expected, 4);
		}
		await page.getByRole("button", { name: "Seek early entry", exact: true }).click();
		await expect.poll(scale).toBeGreaterThan(1);
		expect(await scale()).toBeLessThan(1.2);
		await page.getByRole("button", { name: "Seek early exit", exact: true }).click();
		await expect.poll(scale).toBeGreaterThan(1.35);
		expect(await scale()).toBeLessThan(1.5);
		await page.getByRole("button", { name: "Seek exit midpoint", exact: true }).click();
		await expect.poll(scale).toBeGreaterThan(1);
		expect(await scale()).toBeLessThan(1.5);
		await page.getByRole("button", { name: "Resume through zoom-out", exact: true }).click();
		await expect
			.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
			.toBeGreaterThanOrEqual(4.05);
		await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
		expect(await scale()).toBe(1);
	});
}

for (const preset of ["focused", "smooth"]) {
	test(`${preset} zoom completes its full settling tail after the displayed block ends`, async ({
		page,
	}) => {
		await installDesktopBridge(page, "filmstrip.mp4");
		await page.goto(
			`/tests/ui/paused-motion.html?timing&visualBounds${preset === "smooth" ? "&smooth" : ""}`,
		);
		const main = page.locator("main");
		const video = page.locator("video").first();
		const zoom = page.locator('[data-timeline-item][data-variant="zoom"]');
		await expect(main).toHaveAttribute("data-ready", "true");
		await expect(zoom).toHaveAttribute("data-stored-end-ms", "4000");
		const visibleEnd = Number(await zoom.getAttribute("data-end-ms"));
		expect(visibleEnd).toBeGreaterThan(3500);
		expect(visibleEnd).toBeLessThan(3750);
		await page.getByRole("button", { name: "Seek zoom start", exact: true }).click();
		await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.seeking)).toBe(false);
		await page.getByRole("button", { name: "Resume through zoom-out", exact: true }).click();
		await expect
			.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
			.toBeGreaterThanOrEqual(4.05);
		await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
		const frames = JSON.parse((await main.getAttribute("data-pan-samples"))!) as Array<{
			time: number;
			scale: number;
		}>;
		const tail = frames.filter((frame) => frame.time > visibleEnd / 1000 && frame.time < 3.95);
		await test.info().attach("zoom-visible-bound-and-full-settling.json", {
			body: JSON.stringify({ visibleEndMs: visibleEnd, fullMotionEndMs: 4000, frames }),
			contentType: "application/json",
		});
		expect(tail.length).toBeGreaterThan(2);
		expect(tail[0].scale).toBeGreaterThan(1);
		expect(tail.at(-1)!.scale).toBeLessThan(tail[0].scale);
		await expect
			.poll(async () => {
				await page.getByRole("button", { name: "Read camera", exact: true }).click();
				return Number(await main.getAttribute("data-camera-scale"));
			})
			.toBe(1);
	});
}

for (const cursor of [false, true]) {
	test(`pause/resume preserves ${cursor ? "cursor" : "camera"} motion without a decoder seek`, async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await installDesktopBridge(page, "filmstrip.mp4");
		await page.goto(`/tests/ui/paused-motion.html${cursor ? "?cursor" : ""}`);
		await expect(page.locator("main")).toHaveAttribute("data-ready", "true");
		const video = page.locator("video").first();
		await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.seeking)).toBe(false);
		await video.evaluate((v) => {
			v.dataset.seekCount = "0";
			v.addEventListener("seeking", () => {
				v.dataset.seekCount = String(Number(v.dataset.seekCount) + 1);
			});
		});
		const canvas = page.locator("canvas").first();
		for (let cycle = 0; cycle < 3; cycle++) {
			const before = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
			await page.getByRole("button", { name: "Play", exact: true }).click();
			await expect
				.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
				.toBeGreaterThan(before + 0.1);
			await page.getByRole("button", { name: "Pause", exact: true }).click();
			const pausedTime = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
			const frame = await canvas.screenshot();
			expect(await canvas.screenshot()).toEqual(frame);
			expect(await video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBe(pausedTime);
			await expect(video).toHaveAttribute("data-seek-count", "0");
		}
		expect(errors).toEqual([]);
	});

	test(`paused ${cursor ? "cursor" : "camera"} blur survives scrubbing and holds its frame`, async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await installDesktopBridge(page, "filmstrip.mp4");
		await page.goto(`/tests/ui/paused-motion.html${cursor ? "?cursor" : ""}`);
		await expect(page.locator("main")).toHaveAttribute("data-ready", "true");
		const canvas = page.locator("canvas").first();
		const snapshot = async () => (await canvas.screenshot()).toString("base64");
		const blurred = await snapshot();
		await expect.poll(snapshot).toBe(blurred);
		await page.getByRole("button", { name: "Toggle blur" }).click();
		await expect.poll(snapshot).not.toBe(blurred);
		await page.getByRole("button", { name: "Toggle blur" }).click();
		await expect.poll(snapshot).toBe(blurred);
		await page.getByRole("button", { name: "Seek elsewhere" }).click();
		await expect
			.poll(() =>
				page
					.locator("video")
					.first()
					.evaluate((v: HTMLVideoElement) => v.currentTime),
			)
			.toBeCloseTo(3, 2);
		await page.getByRole("button", { name: "Seek back" }).click();
		await expect.poll(snapshot).toBe(blurred);
		expect(errors).toEqual([]);
	});
}
