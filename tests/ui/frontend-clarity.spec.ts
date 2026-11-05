import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("upgrade stays secondary and project titles open or select the recording", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.cloudShareManage = async () => ({ success: true, videos: [] });
		// Discounts are shown only when returned by a verified public catalog.
		window.electronAPI.cloudBilling = async ({ action }) => {
			if (action !== "catalog") return { success: false, httpStatus: 404 };
			return {
				success: true,
				prices: [
					{
						interval: "monthly",
						currency: "usd",
						unitAmount: 900,
						regularUnitAmount: 1500,
						promotion: "early_bird",
					},
				],
				limits: {
					freeRecordingLimit: 5,
					freeMaxRecordingBytes: 1_000_000_000,
					plusMaxRecordingBytes: 10_000_000_000,
					storageLimitBytes: null,
				},
			};
		};
		window.electronAPI.listProjectFiles = async () => ({
			success: true,
			entries: [
				{
					path: "/projects/walkthrough.recordly",
					name: "A detailed product walkthrough with a title that needs more than one line",
					updatedAt: Date.now(),
					thumbnailPath: `${location.origin}/tests/ui/fixtures/recording-thumbnail.jpg`,
					isCurrent: false,
					isInProjectsDirectory: true,
				},
			],
		});
		window.electronAPI.openProjectFileAtPath = async (path) => {
			document.documentElement.dataset.titleOpenedProject = path;
			return { success: false, canceled: true };
		};
	});
	await page.goto("/?windowType=editor");
	await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible({
		timeout: 30000,
	});
	const upgrade = page
		.locator(".editor-header")
		.getByRole("button", { name: "Upgrade to Cloud, 40% off", exact: true });
	await expect(upgrade).toHaveClass(/button--secondary/);
	await expect(upgrade).not.toHaveClass(/plus-badge/);
	await expect(upgrade.getByText("40% off", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Publish", exact: true })).toHaveClass(
		/button--primary/,
	);
	await page.screenshot({
		path: test.info().outputPath("editor-secondary-upgrade.png"),
		animations: "disabled",
	});
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const home = page.getByRole("dialog", { name: "Projects dashboard", exact: true });
	await expect(home.getByRole("heading", { name: "Your projects", exact: true })).toBeVisible();
	await expect(home.getByText("1 project", { exact: true })).toBeVisible();
	await expect(home.getByText("Local only", { exact: true })).toBeVisible();
	await expect(home.getByRole("button", { name: "Shared links", exact: true })).toBeVisible();
	await expect(home.getByRole("button", { name: "Open raw folder", exact: true })).toHaveCount(0);
	await home.getByRole("button", { name: "Recordly account", exact: true }).click();
	const menu = page.getByRole("dialog", { name: "Account menu", exact: true });
	await expect(menu.getByRole("button", { name: "Open raw folder", exact: true })).toBeVisible();
	await page.keyboard.press("Escape");
	const title = "A detailed product walkthrough with a title that needs more than one line";
	const thumbnail = home.getByRole("button", { name: title, exact: true });
	const beforeHover = await thumbnail.boundingBox();
	await thumbnail.hover();
	await expect.poll(async () => (await thumbnail.boundingBox())?.width).toBe(beforeHover?.width);
	await page.screenshot({
		path: test.info().outputPath("library-navigation.png"),
		animations: "disabled",
	});
	await home.getByRole("button", { name: `Open ${title}`, exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute(
		"data-title-opened-project",
		"/projects/walkthrough.recordly",
	);
	await expect(
		home.getByRole("list", { name: "Your projects" }).getByLabel("Test User"),
	).toHaveCount(0);
	await home.getByRole("button", { name: "Select projects to delete", exact: true }).click();
	const selectTitle = home.getByRole("button", { name: `Select ${title}`, exact: true });
	await selectTitle.click();
	await expect(selectTitle).toHaveAttribute("aria-pressed", "true");
	await expect(home.getByText("1 selected", { exact: true })).toBeVisible();
	await page.screenshot({
		path: test.info().outputPath("project-card-content.png"),
		animations: "disabled",
	});
});

test("scene shows frame controls in Padding, Blur, Shadow, Radius order", async ({ page }) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	const padding = page.getByRole("slider", { name: "Padding", exact: true });
	await expect(padding).toBeVisible({ timeout: 30000 });
	await expect(page.getByRole("button", { name: "Background details", exact: true })).toHaveCount(
		0,
	);
	let previousY = -1;
	for (const name of ["Padding", "Blur", "Shadow", "Radius"]) {
		const slider = page.getByRole("slider", { name, exact: true });
		await expect(slider).toBeVisible();
		const bounds = await slider.boundingBox();
		expect(bounds).not.toBeNull();
		expect(bounds!.y).toBeGreaterThan(previousY);
		previousY = bounds!.y;
	}
	const blur = page.getByRole("slider", { name: "Blur", exact: true });
	const before = Number(await blur.inputValue());
	await blur.focus();
	await page.keyboard.press("ArrowRight");
	await expect(blur).toHaveValue(String(before + 0.25));
	await page.screenshot({
		path: test.info().outputPath("scene-controls.png"),
		animations: "disabled",
	});
});
