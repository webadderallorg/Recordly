import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("playback timestamps keep digits and transport buttons stationary", async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	await expect(page.locator("[data-preview-overlay]")).toBeVisible({ timeout: 20000 });
	await page.evaluate(() => document.fonts.ready);
	const transport = page.locator(".editor-playback-center");
	for (const timer of await transport.getByRole("timer").all()) {
		const typography = await timer.evaluate((node) => {
			const style = getComputedStyle(node);
			return {
				family: style.fontFamily,
				inheritedFamily: getComputedStyle(node.parentElement!).fontFamily,
				size: style.fontSize,
				weight: style.fontWeight,
			};
		});
		expect(typography.family).toBe(typography.inheritedFamily);
		expect(typography.family).toContain("DM Sans");
		expect(typography.size).toBe("10px");
		expect(typography.weight).toBe("500");
	}
	const measurements = await transport.evaluate((root) => {
		const time = root.querySelector('[role="timer"]')!;
		const slots = [...time.children];
		const original = slots.map((slot) => slot.textContent);
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
			for (let i = 0; i < slots.length; i++) slots[i].textContent = value[i];
			positions.push({
				buttons: [...root.querySelectorAll("button")].map(
					(node) => node.getBoundingClientRect().x,
				),
				slots: slots.map((slot) => slot.getBoundingClientRect().x),
				glyphsFit: slots.every((slot) => {
					const range = document.createRange();
					range.selectNodeContents(slot);
					return (
						range.getBoundingClientRect().width <=
						slot.getBoundingClientRect().width + 0.1
					);
				}),
			});
		}
		for (let i = 0; i < slots.length; i++) slots[i].textContent = original[i];
		return positions;
	});
	for (const measurement of measurements) {
		for (let i = 0; i < measurement.buttons.length; i++)
			expect(Math.abs(measurement.buttons[i] - measurements[0].buttons[i])).toBeLessThan(0.1);
		for (let i = 0; i < measurement.slots.length; i++)
			expect(Math.abs(measurement.slots[i] - measurements[0].slots[i])).toBeLessThan(0.1);
		expect(measurement.glyphsFit).toBe(true);
	}
	await page.getByRole("button", { name: "Play", exact: true }).click();
	const samples = await transport.evaluate(async (root) => {
		const samples = [];
		const start = performance.now();
		while (performance.now() - start < 1800) {
			await new Promise(requestAnimationFrame);
			samples.push({
				time: root.querySelector('[role="timer"]')!.textContent,
				slots: [...root.querySelector('[role="timer"]')!.children].map(
					(slot) => slot.getBoundingClientRect().x,
				),
				x: root.querySelectorAll("button")[1].getBoundingClientRect().x,
			});
		}
		return samples;
	});
	expect(new Set(samples.map((sample) => sample.time)).size).toBeGreaterThan(5);
	expect(
		Math.max(...samples.map((s) => s.x)) - Math.min(...samples.map((s) => s.x)),
	).toBeLessThan(0.1);
	for (const sample of samples)
		for (let i = 0; i < sample.slots.length; i++)
			expect(Math.abs(sample.slots[i] - samples[0].slots[i])).toBeLessThan(0.1);
	await page.getByRole("button", { name: "Pause", exact: true }).click();
	await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
	await page.screenshot({ path: test.info().outputPath("playback-timestamps.png") });
});
