import { expect, test } from "@playwright/test";

test("redaction selection preserves the covered area and does not animate camera positioning", async ({
	page,
}) => {
	await page.goto("/tests/ui/annotation-redaction.html");
	const redaction = page.locator('[data-annotation-id="redaction"]');
	const content = redaction.locator('[style*="backdrop-filter"]');
	const before = (await content.boundingBox())!;
	const sample = { x: before.x + 40, y: before.y + 40, width: 80, height: 80 };
	const blurFilter = await content.evaluate(
		(element: HTMLElement) => element.style.backdropFilter,
	);
	const blurred = await page.screenshot({ clip: sample });
	await content.evaluate((element: HTMLElement) => {
		element.style.backdropFilter = "none";
	});
	expect(await page.screenshot({ clip: sample })).not.toEqual(blurred);
	await content.evaluate((element: HTMLElement, filter) => {
		element.style.backdropFilter = filter;
	}, blurFilter);
	await page.getByRole("button", { name: "Toggle selection" }).click();
	await expect.poll(() => content.boundingBox()).toEqual(before);
	expect(await page.screenshot({ clip: sample })).toEqual(blurred);
	await expect(redaction).toHaveCSS("transition-property", "none");
	await expect(redaction).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
	await page.getByRole("button", { name: "Move redaction" }).click();
	await expect(redaction).toHaveCSS("transform", "matrix(1, 0, 0, 1, 320, 80)");
	await page.getByRole("button", { name: "Toggle solid" }).click();
	await expect(content).toHaveCSS("background-color", "rgb(0, 0, 0)");
	await page.screenshot({ path: "test-results/annotation-redaction-selected.png" });
});
