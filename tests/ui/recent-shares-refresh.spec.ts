import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("Retry requests the server after a failed focus refresh even with a fresh cached list", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.cloudShareManage = async () => {
			const state = document.documentElement.dataset;
			state.shareReads = String(Number(state.shareReads ?? 0) + 1);
			if (state.failShareRefresh) return { success: false, error: "Temporarily offline" };
			return {
				success: true,
				videos: [
					{
						code: "demo",
						title: "Shared demo",
						ready: true,
						size: 1024,
						url: "https://share.example.test/s/demo",
						createdAt: "2026-11-09 10:00:00",
					},
				],
			};
		};
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const home = page.getByRole("dialog", { name: "Projects dashboard", exact: true });
	const featured = home.getByRole("region", { name: "Recently shared videos" });
	await expect(featured.getByRole("listitem")).toHaveCount(1);
	await page.evaluate(() => {
		document.documentElement.dataset.failShareRefresh = "true";
		window.dispatchEvent(new Event("focus"));
	});
	const failure = featured
		.getByRole("status")
		.filter({ hasText: "Could not load shared videos." });
	await expect(failure).toBeVisible();
	await expect(featured.getByRole("listitem")).toHaveCount(1);
	await page.evaluate(() => {
		delete document.documentElement.dataset.failShareRefresh;
	});
	const beforeRetry = Number(await page.locator("html").getAttribute("data-share-reads"));
	// Activate as a virtual press so window focus cannot add a separate refresh.
	await featured
		.getByRole("button", { name: "Retry", exact: true })
		.evaluate((button: HTMLButtonElement) => button.click());
	await expect
		.poll(async () => Number(await page.locator("html").getAttribute("data-share-reads")))
		.toBeGreaterThan(beforeRetry);
	await expect(failure).toHaveCount(0);
});
