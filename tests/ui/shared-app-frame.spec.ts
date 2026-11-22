import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

for (const width of [1440, 800]) {
	test(`Home and editor share chrome and account placement at ${width}px`, async ({ page }) => {
		test.setTimeout(60000);
		await page.setViewportSize({ width, height: 1000 });
		if (width === 800)
			await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
		await installDesktopBridge(page);
		await installDesktopBridgeOverrides(page, () => {
			window.electronAPI.listProjectFiles = async () => ({
				success: true,
				entries: [
					{
						path: "/projects/Untitled Project.recordly",
						name: "Untitled Project",
						updatedAt: Date.now(),
						thumbnailPath: null,
						isCurrent: true,
						isInProjectsDirectory: true,
					},
					{
						path: "/projects/Other.recordly",
						name: "Other project",
						updatedAt: Date.now(),
						thumbnailPath: null,
						isCurrent: false,
						isInProjectsDirectory: true,
					},
				],
			});
			window.electronAPI.openProjectFileAtPath = async () => {
				document.documentElement.dataset.projectReopened = "true";
				return { success: false, canceled: true };
			};
		});
		await page.goto("/?windowType=editor");
		const editorHeader = page.locator(".editor-header");
		await expect(editorHeader).toBeVisible({ timeout: 30000 });
		await expect(page.getByRole("button", { name: "Join Discord", exact: true })).toHaveCount(
			0,
		);
		const editorAccount = editorHeader.getByRole("button", {
			name: "Recordly account",
			exact: true,
		});
		const headerBounds = await editorHeader.boundingBox();
		const accountBounds = await editorAccount.boundingBox();
		await expect(page.locator(".editor-inspector")).toBeVisible();
		const editorSurface = await page
			.locator(".editor-inspector .app-frame-surface")
			.evaluate((element) => {
				const style = getComputedStyle(element);
				return { background: style.backgroundColor, radius: style.borderRadius };
			});
		await page.getByRole("button", { name: "Home", exact: true }).click();
		const home = page.getByRole("dialog", { name: "Projects dashboard", exact: true });
		await expect(home).toBeVisible();
		await expect(home).not.toHaveAttribute("data-entering");
		await expect(home.getByRole("button", { name: "Join Discord", exact: true })).toBeVisible();
		const homeHeader = home.locator(".app-frame-header");
		expect(await homeHeader.boundingBox()).toEqual(headerBounds);
		const homeAccount = homeHeader.getByRole("button", {
			name: "Recordly account",
			exact: true,
		});
		expect(await homeAccount.boundingBox()).toEqual(accountBounds);
		expect(
			await home.locator(".app-frame-surface").evaluate((element) => {
				const style = getComputedStyle(element);
				return { background: style.backgroundColor, radius: style.borderRadius };
			}),
		).toEqual(editorSurface);
		await expect(home.getByLabel("Library navigation")).toBeVisible();
		await expect(home.getByText("Currently editing", { exact: true })).toHaveCount(1);
		await expect(
			home.getByRole("button", { name: "Untitled Project", exact: true }),
		).toHaveAttribute("aria-current", "true");
		await homeAccount.click();
		await expect(page.getByRole("dialog", { name: "Account menu", exact: true })).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.getByRole("dialog", { name: "Account menu", exact: true })).toHaveCount(
			0,
		);
		await expect(home).toBeVisible();
		await home
			.getByRole("textbox", { name: "Search projects", exact: true })
			.fill("no matching projects");
		const resume = home.getByRole("button", { name: "Resume Untitled Project", exact: true });
		await expect(resume).toHaveClass(/button--ghost/);
		await resume.click();
		await expect(home).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Join Discord", exact: true })).toHaveCount(
			0,
		);
		await expect(editorAccount).toBeVisible();
		await expect(page.locator(".editor-inspector")).toBeVisible();
		await expect(page.locator("html")).not.toHaveAttribute("data-project-reopened");
	});
}
