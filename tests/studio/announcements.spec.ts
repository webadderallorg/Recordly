import { mkdir, rm, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

async function open(page: import("@playwright/test").Page) {
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await page.goto("/announcement-studio.html");
	await expect(
		page.getByRole("heading", { name: "Announcement Studio", exact: true }),
	).toBeVisible();
	const frame = page.frameLocator("iframe");
	await expect(
		frame.getByRole("dialog", { name: "Projects dashboard", exact: true }),
	).toBeVisible();
	await expect(
		frame.getByRole("heading", { name: "A faster Recordly is here", exact: true }),
	).toBeVisible();
	return { frame, errors };
}
test("real popup edits, closes, replays and follows theme and iframe viewport", async ({
	page,
}) => {
	const { frame, errors } = await open(page);
	await page.getByLabel("Title", { exact: true }).fill("Preview the updated UI");
	await expect(frame.getByRole("heading", { name: "Preview the updated UI" })).toBeVisible();
	await frame
		.locator("button")
		.filter({ hasText: /^Dismiss$/ })
		.click();
	await expect(frame.getByRole("heading", { name: "Preview the updated UI" })).toBeHidden();
	await page.getByRole("button", { name: "Replay", exact: true }).click();
	await expect(frame.getByRole("heading", { name: "Preview the updated UI" })).toBeVisible();
	await page.getByLabel("Theme", { exact: true }).selectOption("light");
	await expect(frame.locator("html")).toHaveAttribute("data-theme", "light");
	await page.getByLabel("Viewport preset").selectOption("narrow");
	await expect(frame.locator("body")).toHaveJSProperty("clientWidth", 390);
	await page.screenshot({ path: "/tmp/recordly-studio-narrow.png" });
	expect(errors).toEqual([]);
});
test("header banner automatically previews real editor and notification uses HeroUI", async ({
	page,
}) => {
	const { frame, errors } = await open(page);
	await page.getByLabel("Placement", { exact: true }).selectOption("banner");
	await expect(page.getByLabel("View", { exact: true })).toHaveValue("editor");
	await expect(frame.getByText("A faster Recordly is here", { exact: true })).toBeVisible();
	await expect(frame.getByRole("button", { name: "Publish", exact: true })).toBeVisible();
	await page.screenshot({ path: "/tmp/recordly-studio-banner.png" });
	await page.getByLabel("Placement", { exact: true }).selectOption("notification");
	await expect(frame.getByText("A faster Recordly is here", { exact: true })).toBeVisible();
	expect(errors).toEqual([]);
});
test("image uploads render in dashboard and export a public path, not temporary URL", async ({
	page,
	request,
}) => {
	const { frame, errors } = await open(page);
	await page.getByLabel("Placement", { exact: true }).selectOption("dashboard-banner");
	await page
		.getByLabel("Choose local media (up to 50 MB)", { exact: true })
		.setInputFiles("public/app-icons/recordly-128.png");
	const image = frame.getByRole("img", { name: "recordly-128.png", exact: true });
	await expect(image).toBeVisible();
	await expect
		.poll(() => image.evaluate((i: HTMLImageElement) => i.naturalWidth))
		.toBeGreaterThan(0);
	const src = await image.getAttribute("src");
	expect(src).toMatch(/^\/__studio\/media\//);
	const response = await request.get(src!, { headers: { Range: "bytes=0-15" } });
	expect(response.status()).toBe(206);
	expect((await response.body()).length).toBe(16);
	const output = JSON.parse(await page.locator("pre code").innerText());
	expect(output.banners[0].src).toBe("/recordly-128.png");
	expect(errors).toEqual([]);
});
test("full-size window receives draft and live changes", async ({ page }) => {
	await open(page);
	const popupPromise = page.waitForEvent("popup");
	await page.getByRole("button", { name: "Open full size" }).click();
	const popup = await popupPromise;
	await expect(popup.getByRole("heading", { name: "A faster Recordly is here" })).toBeVisible();
	await page.getByLabel("Title", { exact: true }).fill("Full-size live edit");
	await expect(popup.getByRole("heading", { name: "Full-size live edit" })).toBeVisible();
	await popup.close();
});
test("studio fits narrow browser and keeps native settings out of saved draft", async ({
	page,
}) => {
	await open(page);
	await page.getByLabel("Title", { exact: true }).fill("Saved draft");
	await page.reload();
	await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Saved draft");
	const keys = await page.evaluate(() => Object.keys(localStorage));
	expect(keys).toEqual(["recordly-announcement-studio-draft-v1"]);
	await page.setViewportSize({ width: 390, height: 844 });
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth))
		.toBeLessThanOrEqual(390);
	await page.getByLabel("ID", { exact: true }).fill("");
	await expect(page.getByRole("button", { name: "Copy JSON", exact: true })).toBeDisabled();
	await page.screenshot({ path: "/tmp/recordly-studio-mobile-browser.png", fullPage: true });
});

test("background source edits do not reload the studio or steal dropdown focus", async ({
	page,
}) => {
	await open(page);
	const started = await page.evaluate(() => performance.timeOrigin);
	const probe = ".tmp/studio-dropdown-regression/source.ts";
	await mkdir(".tmp/studio-dropdown-regression", { recursive: true });
	const view = page.getByLabel("View", { exact: true });
	try {
		await view.click();
		await writeFile(probe, `export const changed = ${Date.now()};`);
		// Give the dev watcher a chance to process the external source edit while the menu is open.
		await page.waitForTimeout(800);
		await expect(view).toBeFocused();
		expect(await page.evaluate(() => performance.timeOrigin)).toBe(started);
		await page.keyboard.press("Escape");
		await view.selectOption("editor");
		await expect(view).toHaveValue("editor");
		const theme = page.getByLabel("Theme", { exact: true });
		await theme.click();
		await page.waitForTimeout(300);
		await expect(theme).toBeFocused();
		await page.keyboard.press("Escape");
		await theme.selectOption("light");
		await expect(theme).toHaveValue("light");
		await expect(page.frameLocator("iframe").locator("html")).toHaveAttribute(
			"data-theme",
			"light",
		);
	} finally {
		await rm(".tmp/studio-dropdown-regression", { recursive: true, force: true });
	}
});
