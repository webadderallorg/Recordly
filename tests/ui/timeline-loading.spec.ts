import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("timeline keeps its wireframe until video metadata loads", async ({ page }) => {
	await installDesktopBridge(page);
	let release!: () => void;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/tests/ui/fixtures/preview.mp4*", async (route) => {
		await pending;
		await route.continue();
	});
	try {
		await page.goto("/?windowType=editor", { waitUntil: "domcontentloaded" });
		const timeline = page.locator("[data-timeline-panel]");
		const loading = timeline.locator("[data-loading-timeline]");
		await expect(loading).toBeVisible({ timeout: 20000 });
		await expect(loading).toHaveAttribute("aria-busy", "true");
		await expect(loading).toHaveAccessibleName("Loading timeline");
		await expect(loading.locator(".skeleton")).toHaveCount(4);
		await expect(page.getByText("No Video Loaded", { exact: true })).toHaveCount(0);
		await expect(page.getByText("Drag and drop a video to start editing")).toHaveCount(0);
		await page.screenshot({ path: "test-results/timeline-metadata-loading.png" });

		release();
		await expect(timeline.getByTestId("timeline-scroll")).toBeVisible({ timeout: 20000 });
		await expect(loading).toHaveCount(0);
		await expect(timeline.locator('[data-variant="clip"]')).not.toHaveCount(0);
	} finally {
		release();
	}
});
