import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

for (const side of [600, 760]) {
for (const reducedMotion of ["no-preference", "reduce"] as const) {
	test(`the same onboarding button widens into Start recording (${reducedMotion}, ${side}px)`, async ({ page }) => {
		await page.setViewportSize({ width: side, height: side });
		await page.emulateMedia({ reducedMotion });
		await installDesktopBridge(page, "preview.mp4", { signedIn: false });
		await page.goto("/?windowType=onboarding&onboardingPreview=1");
		const dialog = page.getByRole("dialog", { name: "Welcome to Recordly" });
		const primary = dialog.locator("[data-onboarding-primary-action]");
		await expect(primary).toHaveAccessibleName("Continue");
		// Measure after the modal itself finishes opening.
		await expect.poll(() => primary.evaluate((element) => {
			let opacity = 1;
			for (let node: Element | null = element; node; node = node.parentElement) {
				opacity *= Number(getComputedStyle(node).opacity);
			}
			return opacity;
		})).toBe(1);
		const before = (await primary.boundingBox())!;
		expect(before.height).toBe(44);
		await primary.evaluate((element) => {
			element.setAttribute("data-persistent-button", "true");
			const samples: { width: number; right: number; bottom: number; opacity: number; connected: boolean }[] = [];
			let frame = 0;
			const sample = () => {
				const rect = element.getBoundingClientRect();
				let opacity = 1;
				for (let node: Element | null = element; node; node = node.parentElement) {
					opacity *= Number(getComputedStyle(node).opacity);
				}
				samples.push({ width: rect.width, right: rect.right, bottom: rect.bottom, opacity, connected: element.isConnected });
				frame = requestAnimationFrame(sample);
			};
			sample();
			Object.assign(window, { finishButtonSamples: () => { cancelAnimationFrame(frame); return samples; } });
		});
		await primary.click();
		await expect(primary).toHaveAccessibleName("Start recording");
		await expect(primary).toHaveAttribute("data-persistent-button", "true");
		await expect(primary).toBeEnabled();
		const samples = await primary.evaluate(async () => {
			const start = performance.now();
			while (performance.now() - start < 650) await new Promise(requestAnimationFrame);
			return (window as unknown as { finishButtonSamples: () => { width: number; right: number; bottom: number; opacity: number; connected: boolean }[] }).finishButtonSamples();
		});
		const after = (await primary.boundingBox())!;
		expect(after.height).toBe(44);
		await test.info().attach("button-animation", {
			body: JSON.stringify({ before, after, samples }),
			contentType: "application/json",
		});
		expect(after.width).toBeGreaterThan(before.width + 20);
		expect(samples.every((sample) => sample.connected && sample.opacity > 0.25)).toBe(true);
		expect(Math.max(...samples.map((sample) => Math.abs(sample.bottom - before.y - before.height)))).toBeLessThanOrEqual(1);
		expect(Math.max(...samples.map((sample) => Math.abs(sample.right - before.x - before.width)))).toBeLessThanOrEqual(1);
		if (reducedMotion === "no-preference") {
			expect(samples.some((sample) => sample.width > before.width + 3 && sample.width < after.width - 3)).toBe(true);
		}
		const heading = dialog.getByRole("heading", { name: "Allow Recordly to record", exact: true });
		await expect(heading).toHaveCSS("text-align", "center");
		const headingBox = (await heading.boundingBox())!;
		const body = (await dialog.locator(".onboarding-body-content").boundingBox())!;
		expect(Math.abs(headingBox.x + headingBox.width / 2 - body.x - body.width / 2)).toBeLessThanOrEqual(1);
		await dialog.screenshot({ path: test.info().outputPath("permissions.png"), animations: "disabled" });
		await dialog.getByRole("button", { name: "Back to account" }).click();
		await expect(primary).toHaveAccessibleName("Continue");
		await expect(primary).toHaveAttribute("data-persistent-button", "true");
	});
}
}
