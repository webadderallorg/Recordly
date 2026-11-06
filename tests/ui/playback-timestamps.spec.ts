import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("playback timestamps keep digits and transport buttons stationary", async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	await expect(page.locator("[data-preview-overlay]")).toBeVisible({ timeout: 20000 });
	await page.evaluate(() => document.fonts.ready);
	const transport = page.locator(".editor-playback-center");
	const measurements = await transport.evaluate((root) => {
		const time = root.querySelector("span")!;
		const original = time.textContent;
		const positions = [];
		// Exercise every digit independently of the short fixture's duration.
		for (const value of [
			"0:00.0",
			"0:11.1",
			"0:22.2",
			"0:33.3",
			"0:44.4",
			"0:55.5",
			"0:06.6",
			"0:07.7",
			"0:08.8",
			"0:09.9",
			"9:59.9",
			"1:00.0",
		]) {
			time.textContent = value;
			const range = document.createRange();
			range.setStart(time.firstChild!, value.length - 1);
			range.setEnd(time.firstChild!, value.length);
			positions.push({
				buttons: [...root.querySelectorAll("button")].map(
					(node) => node.getBoundingClientRect().x,
				),
				decimal: range.getBoundingClientRect().x,
			});
		}
		time.textContent = original;
		return positions;
	});
	for (const measurement of measurements) {
		for (let i = 0; i < measurement.buttons.length; i++)
			expect(Math.abs(measurement.buttons[i] - measurements[0].buttons[i])).toBeLessThan(0.1);
		expect(Math.abs(measurement.decimal - measurements[0].decimal)).toBeLessThan(0.1);
	}
	await page.getByRole("button", { name: "Play", exact: true }).click();
	const samples = await transport.evaluate(async (root) => {
		const samples = [];
		const start = performance.now();
		while (performance.now() - start < 1800) {
			await new Promise(requestAnimationFrame);
			samples.push({
				time: root.querySelector("span")!.textContent,
				x: root.querySelectorAll("button")[1].getBoundingClientRect().x,
			});
		}
		return samples;
	});
	expect(new Set(samples.map((sample) => sample.time)).size).toBeGreaterThan(5);
	expect(
		Math.max(...samples.map((s) => s.x)) - Math.min(...samples.map((s) => s.x)),
	).toBeLessThan(0.1);
	await page.getByRole("button", { name: "Pause", exact: true }).click();
	await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
	await page.screenshot({ path: test.info().outputPath("playback-timestamps.png") });
});
