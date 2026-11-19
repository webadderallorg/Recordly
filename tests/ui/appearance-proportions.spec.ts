import { test, expect } from "@playwright/test";
import { installDesktopBridge } from "./bridge";
for (const width of [1440, 760, 420, 320]) {
	test(`Appearance editor previews remain accessible at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 900 });
		await installDesktopBridge(page);
		await page.goto("/?windowType=editor");
		await page.getByRole("button", { name: "Recordly account", exact: true }).click();
		await page
			.getByRole("dialog", { name: "Account menu", exact: true })
			.getByRole("button", { name: "Appearance", exact: true })
			.click();
		const settings = page.getByRole("dialog", { name: "Settings", exact: true });
		await expect(settings).not.toHaveAttribute("data-entering");
		for (const theme of ["Light", "Dark"]) {
			await settings.getByText(theme, { exact: true }).click();
			const picker = settings.getByRole("radiogroup", { name: "Appearance", exact: true });
			await expect(picker.getByRole("radio")).toHaveCount(3);
			const pickerBounds = (await picker.boundingBox())!;
			const rowBounds = (await settings
				.locator(".settings-language-field .settings-row")
				.boundingBox())!;
			expect(
				Math.abs(pickerBounds.x - rowBounds.x),
				"Appearance shares the settings label edge",
			).toBeLessThan(1);
			expect(
				Math.abs(pickerBounds.x + pickerBounds.width - rowBounds.x - rowBounds.width),
				"Appearance extends to the settings control edge",
			).toBeLessThan(1);
			await expect(picker.getByRole("radio", { name: theme, exact: true })).toBeChecked();
			await expect(picker.locator(".theme-preview")).toHaveCount(3);
			await expect
				.poll(() =>
					picker
						.locator(".theme-preview-image")
						.evaluateAll(
							(images) =>
								images.length === 4 &&
								images.every(
									(image) =>
										(image as HTMLImageElement).complete &&
										(image as HTMLImageElement).naturalWidth === 384,
								),
						),
				)
				.toBe(true);
			for (const [index, label] of ["Light", "Dark", "System"].entries())
				await expect(picker.getByRole("radio").nth(index)).toHaveAccessibleName(label);
			await expect(
				picker.locator(
					'.theme-appearance-option[data-selected="true"] .theme-appearance-check',
				),
			).toHaveCSS("opacity", "1");
			const dimensions = await picker.locator(".theme-preview").first().boundingBox();
			expect(dimensions!.width / dimensions!.height).toBeCloseTo(1.6, 1);
			await expect(picker.locator(".theme-preview-system .theme-preview-layer")).toHaveCount(
				2,
			);
			const panel = settings.getByRole("tabpanel");
			expect(
				await panel.evaluate((element) => element.scrollWidth <= element.clientWidth),
			).toBe(true);
			await settings.screenshot({
				path: test.info().outputPath(`settings-modal-${width}-${theme}.png`),
				animations: "disabled",
			});
			await settings.locator(".theme-appearance-picker").screenshot({
				path: `test-results/appearance-proportions-${width}-${theme}.png`,
				animations: "disabled",
			});
		}
		const system = settings.getByRole("radio", { name: "System", exact: true });
		await system.focus();
		await system.press("Space");
		await expect(system).toBeChecked();
		await page.emulateMedia({ colorScheme: "dark" });
		await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
		await page.emulateMedia({ colorScheme: "light" });
		await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
		await page.keyboard.press("Escape");
		await page
			.getByRole("navigation", { name: "Editor tools", exact: true })
			.getByRole("button", { name: "Settings", exact: true })
			.click();
		await expect(settings.getByRole("radio", { name: "System", exact: true })).toBeChecked();
	});
}
