import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function installShares(page: import("@playwright/test").Page, failFirst = false) {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(
		page,
		({ failFirst }) => {
			window.electronAPI.cloudShareManage = async () => {
				if (failFirst && !document.documentElement.dataset.shareRecovered) {
					return { success: false, error: "Cloud is temporarily unavailable" };
				}
				return {
					success: true,
					videos: Array.from({ length: 8 }, (_, index) => ({
						code: `demo-${index}`,
						title:
							index === 7 && document.documentElement.dataset.shareUpdated
								? "Newest shared demo"
								: `Demo ${index}`,
						size: 1024,
						ready: index !== 0,
						url: `https://share.example.test/s/demo-${index}`,
						createdAt: `2026-10-${String(index + 1).padStart(2, "0")} 12:00:00`,
					})),
				};
			};
			window.electronAPI.openExternalUrl = async (url) => {
				document.documentElement.dataset.openedSharedUrl = url;
				return { success: true };
			};
		},
		{ failFirst },
	);
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	return page.getByRole("dialog", { name: "Projects dashboard", exact: true });
}

test("Home shows recent completed shares, scrolls sideways, opens links, and refreshes", async ({
	page,
}) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	const home = await installShares(page);
	const featured = home.getByRole("region", { name: "Recently shared videos" });
	const carousel = featured.getByRole("list", { name: "Shared video carousel" });
	await expect(featured.getByRole("heading")).toBeVisible();
	await expect(carousel.getByRole("listitem")).toHaveCount(7);
	await expect(carousel.getByRole("listitem").first()).toContainText("Demo 7");
	await expect(
		carousel.getByRole("button", { name: "Open shared video: Demo 0", exact: true }),
	).toHaveCount(0);
	await carousel.getByRole("button", { name: "Open shared video: Demo 7", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute(
		"data-opened-shared-url",
		"https://share.example.test/s/demo-7",
	);
	await featured.getByRole("button", { name: "Next shared videos", exact: true }).click();
	await expect.poll(() => carousel.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
	await featured.getByRole("button", { name: "Previous shared videos", exact: true }).click();
	await expect.poll(() => carousel.evaluate((element) => element.scrollLeft)).toBe(0);
	await page.screenshot({ path: test.info().outputPath("home-shared-videos.png") });
	await page.evaluate(() => {
		document.documentElement.dataset.shareUpdated = "true";
		window.dispatchEvent(new Event("focus"));
	});
	await expect(carousel.getByRole("listitem").first()).toContainText("Newest shared demo");
	await featured.getByRole("button", { name: "View all", exact: true }).click();
	await expect(home.getByRole("list", { name: "Shared projects" })).toBeVisible();
	await expect(featured).toHaveCount(0);
});

test("Home can retry a failed shared-video load", async ({ page }) => {
	const home = await installShares(page, true);
	const featured = home.getByRole("region", { name: "Recently shared videos" });
	const failure = featured
		.getByRole("status")
		.filter({ hasText: "Could not load shared videos." });
	await expect(failure).toContainText("Could not load shared videos.");
	await expect(failure.getByText("Cloud is temporarily unavailable")).not.toBeVisible();
	await failure.getByRole("button", { name: "Technical details", exact: true }).click();
	await expect(failure.getByText("Cloud is temporarily unavailable")).toBeVisible();
	await page.evaluate(() => {
		document.documentElement.dataset.shareRecovered = "true";
	});
	await featured.getByRole("button", { name: "Retry", exact: true }).click();
	await expect(featured.getByRole("listitem")).toHaveCount(7);
	await expect(featured.getByText("Cloud is temporarily unavailable")).toHaveCount(0);
});

test("Home hides the featured row when there are no shared videos", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.cloudShareManage = async () => ({ success: true, videos: [] });
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const home = page.getByRole("dialog", { name: "Projects dashboard", exact: true });
	await expect(home).toBeVisible();
	await expect(home.getByRole("region", { name: "Recently shared videos" })).toHaveCount(0);
});
