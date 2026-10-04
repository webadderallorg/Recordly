import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";
for (const cursor of [false, true]) {
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
