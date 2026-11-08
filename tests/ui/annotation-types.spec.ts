import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("annotations retain all type choices while the separate toolbar is hidden", async ({
	page,
}) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	await expect(page.locator("[data-preview-overlay]")).toBeVisible({ timeout: 20000 });
	await expect(page.getByRole("toolbar", { name: "Annotation tools" })).toHaveCount(0);
	await page.getByRole("button", { name: "Add Layer", exact: true }).click();
	await page.getByRole("menuitem", { name: "Annotation", exact: true }).click();
	const inspector = page.locator("aside");
	const picker = inspector.getByRole("grid", { name: "Annotation type" });
	await expect(picker).toBeVisible();
	const text = inspector.getByRole("textbox").first();
	await text.fill("Keep this annotation text");
	await text.press("Tab");
	for (const label of ["Text", "Image", "Arrow", "Blur"]) {
		await expect(picker.getByRole("row", { name: label, exact: true })).toBeVisible();
	}
	await picker.getByRole("row", { name: "Image", exact: true }).click();
	await expect(
		inspector.getByRole("button", { name: "Upload Image", exact: true }),
	).toBeVisible();
	await picker.getByRole("row", { name: "Arrow", exact: true }).click();
	await expect(inspector.getByText("Arrow Direction", { exact: true })).toBeVisible();
	await picker.getByRole("row", { name: "Blur", exact: true }).click();
	await expect(
		inspector.getByRole("slider", { name: "Blur Strength: 20", exact: true }),
	).toBeVisible();
	await picker.getByRole("row", { name: "Text", exact: true }).click();
	await expect(inspector.getByRole("textbox").first()).toHaveValue("Keep this annotation text");
	await expect(page.locator('[data-variant="annotation"]')).toHaveCount(1);
	await page.screenshot({
		path: "test-results/annotation-types-restored.png",
		animations: "disabled",
	});
});
