import { expect, type Locator, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function expectButtonsFit(container: Locator) {
	const issues = await container.evaluate((root) => {
		const bounds = root.getBoundingClientRect();
		const buttons = Array.from(root.querySelectorAll("button")).filter(
			(button) => button.getBoundingClientRect().width > 0,
		);
		return buttons.flatMap((button) => {
			const rect = button.getBoundingClientRect();
			return rect.left < bounds.left - 1 ||
				rect.right > bounds.right + 1 ||
				button.scrollWidth > button.clientWidth + 2
				? [button.textContent]
				: [];
		});
	});
	expect(issues).toEqual([]);
}
test("clip filmstrip decodes different source frames and zoom blocks use the available height", async ({
	page,
}) => {
	test.setTimeout(60000);
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	const frames = page.getByTestId("clip-filmstrip").locator("img");
	await expect.poll(() => frames.count(), { timeout: 20000 }).toBeGreaterThan(2);
	expect(
		await frames.evaluateAll(
			(images) => new Set(images.map((image) => (image as HTMLImageElement).src)).size,
		),
	).toBeGreaterThan(2);
	await page.getByRole("button", { name: "Add Zoom (Z)", exact: true }).click();
	const zoom = page.locator('[data-timeline-item][data-variant="zoom"] .timeline-block');
	await expect(zoom).toBeVisible();
	expect((await zoom.boundingBox())!.height).toBeGreaterThan(50);
	await expect(page.locator(".timeline-axis")).toHaveCount(0);
	await page.screenshot({
		path: "test-results/editor-filmstrip-zoom.png",
		animations: "disabled",
	});
});

test("advanced controls, webcam defaults and captions have consistent layouts", async ({
	page,
}) => {
	test.setTimeout(60000);
	await installDesktopBridge(page);

	await page.goto("/?windowType=editor");
	await page.getByRole("radio", { name: "Cursor", exact: true }).click();
	await expect(page.getByRole("switch", { name: "Show Cursor", exact: true })).toHaveCount(0);
	await page.locator("aside").getByText("Advanced", { exact: true }).click();
	await expect(page.getByRole("switch", { name: "Show Cursor", exact: true })).toBeVisible();
	await expect(page.getByRole("switch", { name: "Loop cursor", exact: true })).toBeVisible();
	await page.getByRole("radio", { name: "Webcam", exact: true }).click();
	await expect(page.getByRole("switch", { name: "Mirror webcam" })).toHaveCount(0);
	await expect(page.getByRole("switch", { name: "Webcam Reacts To Zoom" })).toHaveCount(0);
	await page.evaluate(() => {
		window.electronAPI.openVideoFilePicker = async () => ({
			success: true,
			path: `${location.origin}/tests/ui/fixtures/preview.mp4`,
		});
	});
	await page.getByRole("button", { name: "Upload footage", exact: true }).click();
	await expect(page.getByRole("row", { name: "Circle", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(page.getByRole("slider", { name: "Webcam Roundness" })).toHaveCount(0);
	await page.getByRole("row", { name: "Square", exact: true }).click();
	await expect(page.getByRole("slider", { name: "Webcam Roundness" })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Replace footage", exact: true })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Webcam source", exact: true })).toHaveCount(0);
	await page.getByRole("switch", { name: "Advanced settings", exact: true }).press("Space");
	await expect(page.getByRole("button", { name: "Webcam source", exact: true })).toBeVisible();
	const remove = page.getByRole("button", { name: "Remove from project", exact: true });
	await remove.scrollIntoViewIfNeeded();
	await expect(remove).toBeVisible();
	await expectButtonsFit(page.locator("aside"));
	await page.screenshot({
		path: "test-results/editor-webcam-footage.png",
		animations: "disabled",
	});
	await page.getByRole("radio", { name: "Captions", exact: true }).click();
	await expect(page.getByRole("button", { name: "Select Model", exact: true })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Use custom", exact: true })).toHaveCount(0);
	await expect(page.getByRole("switch", { name: "Hover to add on timeline" })).toHaveCount(0);
	await expect(page.getByRole("group", { name: "Caption style", exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: /Animation/ })).toHaveCount(0);
	await expectButtonsFit(page.locator("aside"));
	await page.screenshot({
		path: "test-results/editor-captions-basic.png",
		animations: "disabled",
	});
	await page.locator("aside").getByText("Advanced", { exact: true }).click();
	await expect(page.getByRole("slider", { name: "Rows", exact: true })).toBeVisible();
});

test("project dashboard fits long names and editor overlays dismiss with current controls", async ({
	page,
}) => {
	test.setTimeout(60000);
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.listProjectFiles = async () => ({
			success: true,
			projects: [],
			entries: Array.from({ length: 5 }, (_, i) => ({
				path: `/projects/${i}.recordly`,
				name: `A very long project name with many words ${i}`,
				updatedAt: Date.now(),
				thumbnailPath: null,
				isCurrent: i === 0,
				isInProjectsDirectory: true,
			})),
		});
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const projects = page.getByRole("dialog", { name: "Projects dashboard", exact: true });
	await expect(
		projects.getByRole("button", { name: /^A very long project name with many words \d$/ }),
	).toHaveCount(5);
	await expectButtonsFit(projects);
	await page.screenshot({
		path: "test-results/editor-projects-populated.png",
		animations: "disabled",
	});
	// Home fills the window; clicking inside the dashboard must not dismiss it.
	await projects.getByRole("heading", { name: "Your projects", exact: true }).click();
	await expect(projects).toBeVisible();
	await projects.getByRole("button", { name: "Resume Untitled Project", exact: true }).click();
	await expect(projects).toHaveCount(0);
	// Preset creation is intentionally unavailable in the current editor header.
	await expect(page.getByRole("button", { name: "Open presets", exact: true })).toHaveCount(0);
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await page.getByRole("row", { name: "Save to device", exact: true }).click();
	await expect(page.getByRole("grid", { name: "Format", exact: true })).toBeVisible();
	await page.mouse.click(20, 300);
	await expect(page.getByRole("grid", { name: "Format", exact: true })).toHaveCount(0);
	await page.getByRole("button", { name: "Crop", exact: true }).click();
	const crop = page.locator("[data-inline-crop]");
	await expect(crop).toBeVisible();
	await page.mouse.click(20, 300);
	await expect(crop).toBeVisible();
	await crop.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(crop).toHaveCount(0);
});
