import { expect, test } from "@playwright/test";
import { completeSupabaseSignIn } from "./auth";
import { installDesktopBridge } from "./bridge";

test.beforeEach(async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]')).toHaveAttribute("data-end-ms", "6000", {
		timeout: 20000,
	});
	await expect(page.getByLabel("Loading preview")).toHaveCount(0, { timeout: 20000 });
});

test("zoom clips keep their icon and reveal labels as space allows", async ({ page }) => {
	await page.getByRole("button", { name: "Add Zoom (Z)", exact: true }).click();
	const item = page.locator('[data-variant="zoom"]');
	const zoom = item.locator(".timeline-block");
	const icon = zoom.locator(".zoom-icon");
	const heading = zoom.getByText("Zoom", { exact: true });
	const value = zoom.locator(".zoom-value");
	const mode = zoom.locator(".zoom-mode");

	for (const [width, height, hasHeading, hasValue, hasMode] of [
		[28, 44, false, false, false],
		[44, 44, true, false, false],
		[70, 44, true, true, false],
		[180, 44, true, true, true],
		[70, 24, true, false, false],
		[110, 24, true, true, false],
		[180, 24, true, true, true],
	] as const) {
		await zoom.evaluate(
			(node, size) => {
				node.style.width = `${size.width}px`;
				node.style.height = `${size.height}px`;
			},
			{ width, height },
		);
		await expect(icon).toBeVisible();
		await expect(heading).toBeVisible({ visible: hasHeading });
		await expect(value).toBeVisible({ visible: hasValue });
		await expect(mode).toBeVisible({ visible: hasMode });
	}
	await expect(item).toHaveAccessibleName(/Zoom.*\d.*×/);
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

test("rejected cloud sessions can request reauthentication", async ({ page }) => {
	test.setTimeout(60000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	// The desktop session remains signed in; only the cloud service rejects it.
	await page.evaluate(() => {
		window.electronAPI.cloudBilling = async () => ({
			success: false,
			httpStatus: 401,
			error: "Verified sign-in required",
		});
		window.electronAPI.cloudShareManage = async () => ({
			success: false,
			error: "Verified sign-in required",
		});
	});
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await page.getByRole("row", { name: "Create share link", exact: true }).click();
	const publish = page.getByRole("dialog", { name: "Publish", exact: true });
	await expect(publish.getByRole("button", { name: "Share", exact: true })).toBeDisabled();
	await publish.getByRole("button", { name: "Check sign-in", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Sign in to Recordly", exact: true });
	await expect(dialog).toBeVisible();
	const email = dialog.getByRole("textbox", { name: /^Email\*?$/ });
	await expect(email).toBeVisible();
	await email.fill("test@email.com");
	await expect(
		dialog.getByRole("button", { name: "Email me a code", exact: true }),
	).toBeEnabled();
	await expect(dialog.locator("form")).toBeVisible();
	await page.screenshot({ path: "test-results/cloud-sign-in.png", animations: "disabled" });
	expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
	await dialog.getByRole("button", { name: "Close", exact: true }).click();
	await expect(dialog).not.toBeVisible();
	await page.getByRole("button", { name: "Recordly account", exact: true }).click();
	const account = page.getByRole("dialog", { name: "Account menu", exact: true });
	await expect(account).toBeVisible();
	await expect(
		account.getByRole("button", { name: "Manage account", exact: true }),
	).toBeVisible();
	await expect(account.getByText("Test User", { exact: true })).toBeVisible();
	await page.keyboard.press("Escape");
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await page.getByRole("row", { name: "Create share link", exact: true }).click();
	await publish.getByRole("button", { name: "Check sign-in", exact: true }).click();
	await expect(dialog).toBeVisible();
	await dialog.getByRole("button", { name: "Continue with Apple", exact: true }).click();
	await completeSupabaseSignIn(page);
	await expect(dialog).toBeHidden();
	await expect(publish).toBeVisible();
	expect(errors).toEqual([]);
});
