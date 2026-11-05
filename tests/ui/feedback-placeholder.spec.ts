import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

for (const theme of ["light", "dark"]) {
	test(`feedback placeholder is readable in ${theme} mode`, async ({ page }) => {
		await installDesktopBridge(page);
		await page.addInitScript((theme) => localStorage.setItem("recordly.theme", theme), theme);
		await page.addInitScript(() => {
			localStorage.setItem(
				"recordly.feedback.draft.v1.00000000-0000-4000-8000-000000000001",
				JSON.stringify({ sentiment: "loving", message: " \n\t " }),
			);
		});
		await page.goto("/?windowType=editor");
		await page.getByRole("button", { name: "Recordly account", exact: true }).click();
		await page
			.getByRole("dialog", { name: "Account menu", exact: true })
			.getByRole("button", { name: "Feedback", exact: true })
			.click();
		const field = page
			.getByRole("dialog", { name: "Send feedback", exact: true })
			.getByRole("textbox", { name: "Description" });
		await expect(field).toHaveAttribute("placeholder", "We read all feedback...");
		for (const focused of [false, true]) {
			if (focused) await field.focus();
			const appearance = await field.evaluate((element) => {
				const placeholder = getComputedStyle(element, "::placeholder");
				const canvas = document.createElement("canvas");
				canvas.width = canvas.height = 1;
				const context = canvas.getContext("2d")!;
				const luminance = (color: string) => {
					context.clearRect(0, 0, 1, 1);
					context.fillStyle = color;
					context.fillRect(0, 0, 1, 1);
					const channels = [...context.getImageData(0, 0, 1, 1).data]
						.slice(0, 3)
						.map((channel) => {
							const value = channel / 255;
							return value <= 0.04045
								? value / 12.92
								: ((value + 0.055) / 1.055) ** 2.4;
						});
					return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
				};
				const foreground = luminance(placeholder.color);
				const background = luminance(getComputedStyle(element).backgroundColor);
				return {
					shown: element.matches(":placeholder-shown"),
					opacity: placeholder.opacity,
					contrast:
						(Math.max(foreground, background) + 0.05) /
						(Math.min(foreground, background) + 0.05),
				};
			});
			await expect(field).toBeVisible();
			expect(appearance.shown).toBe(true);
			expect(appearance.opacity).toBe("1");
			expect(appearance.contrast).toBeGreaterThanOrEqual(4.5);
		}
		await field.fill(" \n\t ");
		await page
			.getByRole("dialog", { name: "Send feedback", exact: true })
			.getByRole("button", { name: "Close", exact: true })
			.click();
		await page.getByRole("button", { name: "Recordly account", exact: true }).click();
		await page
			.getByRole("dialog", { name: "Account menu", exact: true })
			.getByRole("button", { name: "Feedback", exact: true })
			.click();
		await expect(field).toHaveValue("");
		expect(await field.evaluate((element) => element.matches(":placeholder-shown"))).toBe(true);
	});
}
