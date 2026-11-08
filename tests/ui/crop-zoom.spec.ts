import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

for (const mode of ["auto", "classic", "manual"]) {
	test(`cropped ${mode} zoom centers the intended content`, async ({ page }) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await installDesktopBridge(page, "filmstrip.mp4");
		await page.goto(`/tests/ui/crop-zoom.html${mode === "auto" ? "" : `?${mode}`}`);
		const main = page.locator("main");
		const video = page.locator("video").first();
		await expect(main).toHaveAttribute("data-ready", "true");
		await expect
			.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
			.toBeCloseTo(2, 2);
		await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.seeking)).toBe(false);
		await expect
			.poll(async () => {
				await page.getByRole("button", { name: "Read click position" }).click();
				return Math.abs(Number(await main.getAttribute("data-point-x")) - 0.5);
			})
			.toBeLessThan(0.005);
		expect(Math.abs(Number(await main.getAttribute("data-point-y")) - 0.5)).toBeLessThan(0.005);
		expect(errors).toEqual([]);
	});
}
