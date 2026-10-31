import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

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
		.toBeCloseTo(4.2, 2);
	await expect.poll(cameraOffset).toBeLessThan(1);
	await page.getByRole("button", { name: "Resume through zoom-out", exact: true }).click();
	await expect
		.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { intervals: [50] })
		.toBeGreaterThanOrEqual(4.35);
	await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
	expect(await video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeLessThan(4.7);
	expect(await cameraOffset()).toBeLessThan(1);
	expect(errors).toEqual([]);
});

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
