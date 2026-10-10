import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

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
