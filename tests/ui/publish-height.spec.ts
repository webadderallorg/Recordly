import { expect, test } from "@playwright/test";

test("Publish grows with its contents and only scrolls at the window boundary", async ({
	page,
}) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto("/tests/ui/publish.html");
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await page.getByRole("row", { name: "Save video", exact: true }).click();
	const panel = page.getByRole("dialog", { name: "Publish", exact: true });
	const exportButton = panel.getByRole("button", { name: "Export Video", exact: true });
	const bounds = () =>
		panel.evaluate((dialog) => {
			const rect = dialog.getBoundingClientRect();
			return {
				top: rect.top,
				bottom: rect.bottom,
				height: rect.height,
				scrolling: [...dialog.querySelectorAll<HTMLElement>("*")].some(
					(element) =>
						["auto", "scroll"].includes(getComputedStyle(element).overflowY) &&
						element.scrollHeight > element.clientHeight + 1,
				),
			};
		});
	await expect(exportButton).toBeInViewport({ ratio: 1 });
	await expect.poll(async () => (await bounds()).scrolling).toBe(false);
	const normalHeight = (await bounds()).height;
	await panel.getByText("Advanced", { exact: true }).click();
	await page.setViewportSize({ width: 1280, height: 1000 });
	await expect.poll(async () => (await bounds()).height).toBeGreaterThan(normalHeight);
	await expect.poll(async () => (await bounds()).scrolling).toBe(false);
	await expect(exportButton).toBeInViewport({ ratio: 1 });
	await page.screenshot({
		path: test.info().outputPath("publish-expanded.png"),
		animations: "disabled",
	});
	await page.setViewportSize({ width: 1280, height: 706 });
	const destination = panel.getByRole("row", { name: "Save video", exact: true });
	await expect.poll(async () => (await destination.boundingBox())?.height).toBe(96);
	await expect(panel.locator(".card__content")).toHaveCSS("gap", "16px");
	await page.screenshot({
		path: test.info().outputPath("publish-spacing.png"),
		animations: "disabled",
	});
	await page.setViewportSize({ width: 1280, height: 500 });
	await expect.poll(async () => (await bounds()).bottom).toBeLessThanOrEqual(488);
	await expect.poll(async () => (await bounds()).top).toBeGreaterThanOrEqual(12);
	await exportButton.scrollIntoViewIfNeeded();
	await expect(exportButton).toBeInViewport({ ratio: 1 });
});
