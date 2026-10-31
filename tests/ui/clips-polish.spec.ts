import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test.beforeEach(async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]')).toHaveAttribute("data-end-ms", "6000", {
		timeout: 20000,
	});
	await expect(page.getByLabel("Loading preview")).toHaveCount(0);
});

test("narrow zooms retain the multiplier without a zoom icon", async ({ page }) => {
	await page.getByRole("button", { name: "Add Zoom (Z)", exact: true }).click();
	const zoom = page.locator('[data-variant="zoom"] .timeline-block');
	await zoom.evaluate((node: HTMLElement) => {
		node.style.width = "28px";
	});
	await expect(zoom.locator(".zoom-value")).toBeVisible();
	await expect(zoom.locator(".zoom-mode")).toBeHidden();
	await expect(zoom.locator(".zoom-icon")).toBeHidden();
	expect(await zoom.locator(".zoom-value").innerText()).toMatch(/\d.*×/);
	await zoom.evaluate((node: HTMLElement) => {
		node.style.width = "180px";
	});
	await expect(zoom.locator(".zoom-icon")).toBeVisible();
	await expect(zoom.locator(".zoom-mode")).toBeVisible();
});

test("annotations can be dragged into the canvas background and survive undo", async ({ page }) => {
	await page.getByRole("button", { name: "Add Layer", exact: true }).click();
	await page.getByRole("menuitem", { name: "Annotation", exact: true }).click();
	const annotation = page.locator("[data-annotation-id]");
	await expect(annotation).toBeVisible();
	await annotation.click();
	const overlay = (await page.locator("[data-preview-overlay]").boundingBox())!;
	const box = (await annotation.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(overlay.x + box.width / 2 + 3, overlay.y + box.height / 2 + 3, {
		steps: 12,
	});
	await page.mouse.up();
	await expect.poll(async () => (await annotation.boundingBox())!.x - overlay.x).toBeLessThan(8);
	await expect.poll(async () => (await annotation.boundingBox())!.y - overlay.y).toBeLessThan(8);
	await page.screenshot({ path: "test-results/annotation-canvas.png" });
	await page.locator("[data-timeline-panel]").focus();
	await page.keyboard.press("Meta+z");
	await expect
		.poll(async () => (await annotation.boundingBox())!.x)
		.toBeGreaterThan(overlay.x + 8);
});

test("cloud sharing is reachable from Export and the account control", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.getByRole("button", { name: "Export", exact: true }).click();
	await page.getByRole("button", { name: "Create share link", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Sign into Recordly" })).toBeVisible();
	await expect(
		page.getByText("Sign in to publish this video and manage its shared link."),
	).toBeVisible();
	await page.screenshot({ path: "test-results/cloud-sign-in.png", animations: "disabled" });
	const dialog = page.getByRole("dialog");
	await expect(dialog.locator(".modal__body")).toBeVisible();
	expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
	await page.getByRole("button", { name: "Close", exact: true }).click();
	await page.getByRole("button", { name: "Recordly account", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Sign into Recordly" })).toBeVisible();
	expect(errors).toEqual([]);
});
