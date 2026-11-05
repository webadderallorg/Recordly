import { expect, test } from "@playwright/test";

test("rounded recording masks retain antialiasing through blur passes and radius changes", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", error => errors.push(error.message));
	await page.goto("/tests/ui/rounded-mask.html");
	await expect(page.locator("body")).toHaveAttribute("data-result", /blended/);
	const result = JSON.parse((await page.locator("body").getAttribute("data-result"))!);
	expect(result.defaultBlended).toBe(0);
	expect(result.blended).toBeGreaterThan(10);
	expect(result.squareBlended).toBe(0);
	expect(result.replacedBlended).toBe(result.blended);
	expect(errors).toEqual([]);
});
