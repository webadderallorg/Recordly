import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("gradient gallery starts with a HeroUI creator and saves custom gradients", async ({
	page,
}, testInfo) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	await page.getByRole("row", { name: "Colors", exact: true }).click();
	const gallery = page.locator('[aria-label="Background colors"]');
	await expect(gallery.getByRole("button").first()).toHaveAccessibleName("Add custom color");
	await gallery.getByRole("button", { name: "Add custom color", exact: true }).click();
	await page.getByRole("button", { name: "Create custom gradient", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Custom gradient", exact: true });
	await expect(dialog.getByRole("img", { name: "Gradient preview" })).toBeVisible();
	await dialog.getByRole("button", { name: "Add color", exact: true }).click();
	await expect(dialog.getByRole("button", { name: "Color 3", exact: true })).toBeVisible();
	await dialog.getByRole("button", { name: "Color 1", exact: true }).click();
	const hex = page.getByRole("textbox", { name: "Hex color", exact: true });
	await hex.fill("#FF0000");
	await hex.press("Tab");
	await hex.press("Escape");
	await dialog.getByRole("slider", { name: "Angle", exact: true }).focus();
	await page.keyboard.press("Home");
	await page.keyboard.press("ArrowRight");
	await expect(dialog.getByRole("slider", { name: "Angle", exact: true })).toHaveValue("1");
	await expect(dialog.getByRole("img", { name: "Gradient preview" })).toHaveCSS(
		"background-image",
		/linear-gradient\(1deg, rgb\(255, 0, 0\)/,
	);
	await page.screenshot({ path: testInfo.outputPath("custom-gradient-editor.png") });
	await dialog.getByRole("button", { name: "Save gradient", exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(
		page.getByRole("button", { name: "Custom gradient 1", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					JSON.parse(localStorage.getItem("recordly.editor.preferences") ?? "{}")
						.customGradients?.[0],
			),
		)
		.toBe("linear-gradient(1deg, #ff0000 0%, #22d3ee 50%, #fb7185 100%)");
	await page.reload();
	await page.getByRole("row", { name: "Colors", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Custom gradient 1", exact: true }),
	).toBeVisible();
	await gallery.getByRole("button", { name: "Add custom color", exact: true }).click();
	await page.getByRole("button", { name: "Create custom gradient", exact: true }).click();
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(page.getByRole("button", { name: /^Custom gradient \d+$/ })).toHaveCount(1);
	await page.getByRole("button", { name: "Remove Custom gradient 1", exact: true }).click();
	await expect(page.getByRole("button", { name: "Custom gradient 1", exact: true })).toHaveCount(
		0,
	);
	expect(errors).toEqual([]);
});
