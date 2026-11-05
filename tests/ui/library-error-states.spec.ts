import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function prepare(page: Parameters<typeof installDesktopBridge>[0]) {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getCurrentVideoPath = async () => ({ success: false });
	});
}

test("project empty states distinguish first use, folder and combined filters", async ({
	page,
}) => {
	await prepare(page);
	await page.goto("/?windowType=editor");
	const home = page.getByRole("dialog", { name: "Projects dashboard" });
	await expect(home.getByRole("heading", { name: "No projects yet" })).toBeVisible();
	await expect(home.getByRole("button", { name: "Import video", exact: true })).toBeVisible();
	await home.getByRole("button", { name: "New folder", exact: true }).click();
	await home.getByRole("button", { name: "Untitled folder", exact: true }).click();
	await expect(home.getByRole("heading", { name: "This folder is empty" })).toBeVisible();
	await home.getByRole("button", { name: "Last 7 days", exact: true }).click();
	await home.getByRole("textbox", { name: "Search projects" }).fill("missing");
	await expect(home.getByRole("heading", { name: "No matching projects" })).toBeVisible();
	await home.getByRole("button", { name: "Clear filters", exact: true }).click();
	await expect(home.getByRole("textbox", { name: "Search projects" })).toHaveValue("");
	await expect(home.getByRole("button", { name: "All", exact: true })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await expect(home.getByRole("heading", { name: "No projects yet" })).toBeVisible();
});

test("Open raw folder reports a folder-opening failure and allows retry", async ({ page }) => {
	test.setTimeout(60000);
	await prepare(page);
	await installDesktopBridgeOverrides(page, () => {
		let count = 0;
		window.electronAPI.openRecordingsFolder = async () => {
			count += 1;
			document.documentElement.dataset.rawFolderRequests = String(count);
			return count === 1 ? { success: false, error: "Unavailable" } : { success: true };
		};
	});
	await page.goto("/?windowType=editor");
	const home = page.getByRole("dialog", { name: "Projects dashboard" });
	await home.getByRole("button", { name: "Recordly account", exact: true }).click();
	const menu = page.getByRole("dialog", { name: "Account menu", exact: true });
	const raw = menu.getByRole("button", { name: "Open raw folder", exact: true });
	await raw.click();
	await expect(menu.getByRole("alert")).toContainText("Could not open this folder.");
	await expect(raw).toBeEnabled();
	await raw.click();
	await expect(page.locator("html")).toHaveAttribute("data-raw-folder-requests", "2");
	await expect(menu).not.toBeVisible();
	await expect(home.getByRole("heading", { name: "Your projects", exact: true })).toBeVisible();
});

test("shared list failures have retry without first-use success messaging", async ({ page }) => {
	await prepare(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.cloudShareManage = async () => {
			if (document.documentElement.dataset.testCloudReady !== "true")
				return { success: true, videos: [] };
			return document.documentElement.dataset.testCloudRetry !== "true"
				? { success: false, error: "Cloud library unavailable" }
				: { success: true, videos: [] };
		};
	});
	await page.goto("/?windowType=editor");
	const home = page.getByRole("dialog", { name: "Projects dashboard" });
	await page.evaluate(() => {
		document.documentElement.dataset.testCloudReady = "true";
	});
	await home.getByRole("button", { name: "Shared links", exact: true }).click();
	const library = home.getByRole("main");
	const failure = library.getByRole("alert");
	await expect(failure).toContainText("Could not load shared recordings.");
	await expect(failure.getByText("Cloud library unavailable", { exact: true })).not.toBeVisible();
	await failure.getByRole("button", { name: "Technical details", exact: true }).click();
	await expect(failure.getByText("Cloud library unavailable", { exact: true })).toBeVisible();
	await expect(home.getByRole("heading", { name: "No shared recordings yet" })).toHaveCount(0);
	await page.evaluate(() => {
		document.documentElement.dataset.testCloudRetry = "true";
	});
	await home.getByRole("button", { name: "Retry loading recordings", exact: true }).click();
	await expect(library.getByRole("alert")).toHaveCount(0);
	await expect(home.getByRole("heading", { name: "No shared recordings yet" })).toBeVisible();
	await home.getByRole("button", { name: "Last 7 days", exact: true }).click();
	await home.getByRole("textbox", { name: "Search projects" }).fill("missing");
	await expect(
		home.getByRole("heading", { name: "No matching shared recordings" }),
	).toBeVisible();
	await home.getByRole("button", { name: "Clear filters" }).click();
	await expect(home.getByRole("button", { name: "All", exact: true })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await expect(home.getByRole("heading", { name: "No shared recordings yet" })).toBeVisible();
});

test("shared page retry preserves loaded recordings and requests the failed cursor", async ({
	page,
}) => {
	await prepare(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.cloudShareManage = async ({ cursor }) => {
			if (document.documentElement.dataset.testCloudReady !== "true")
				return { success: true, videos: [] };
			const video = (code: string) => ({
				code,
				title: `Shared ${code}`,
				size: 1234,
				ready: true,
				url: `https://example.test/s/${code}`,
				createdAt: new Date().toISOString(),
			});
			if (!cursor) return { success: true, videos: [video("first")], nextCursor: "page-two" };
			if (document.documentElement.dataset.testCloudRetry !== "true") {
				return { success: false, error: "Next page unavailable" };
			}
			document.documentElement.dataset.retriedCursor = cursor;
			return { success: true, videos: [video("second")] };
		};
	});
	await page.goto("/?windowType=editor");
	const home = page.getByRole("dialog", { name: "Projects dashboard" });
	await page.evaluate(() => {
		document.documentElement.dataset.testCloudReady = "true";
	});
	await home.getByRole("button", { name: "Shared links", exact: true }).click();
	await expect(home.getByRole("button", { name: "Shared first", exact: true })).toBeVisible();
	await home.getByRole("button", { name: "Load more recordings", exact: true }).click();
	const library = home.getByRole("main");
	const failure = library.getByRole("alert");
	await expect(failure).toContainText("Could not load more recordings.");
	await expect(failure.getByText("Next page unavailable", { exact: true })).not.toBeVisible();
	await failure.getByRole("button", { name: "Technical details", exact: true }).click();
	await expect(failure.getByText("Next page unavailable", { exact: true })).toBeVisible();
	await expect(home.getByRole("button", { name: "Shared first", exact: true })).toBeVisible();
	await page.evaluate(() => {
		document.documentElement.dataset.testCloudRetry = "true";
	});
	await home.getByRole("button", { name: "Retry loading more recordings", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-retried-cursor", "page-two");
	await expect(home.getByRole("button", { name: "Shared first", exact: true })).toBeVisible();
	await expect(home.getByRole("button", { name: "Shared second", exact: true })).toBeVisible();
	await expect(library.getByRole("alert")).toHaveCount(0);
});
