import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("editor paints a wireframe before JavaScript loads", async ({ page }) => {
	await page.route("**/src/main.tsx*", (route) => route.abort());
	await page.goto("/?windowType=editor");
	await expect(page.getByRole("status", { name: "Loading editor" })).toBeVisible();
	await expect(page.locator(".boot-preview i").first()).toBeVisible();
	await page.screenshot({ path: "test-results/startup-wireframe.png" });
	await page.goto("/?windowType=hud-overlay");
	await expect(page.locator(".boot-shell")).not.toBeVisible();
});

test("wireframe stays visible while the editor module loads, then gives way to the app", async ({
	page,
}) => {
	await installDesktopBridge(page);
	let release!: () => void;
	const paused = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/components/video-editor/EditorWindow.tsx*", async (route) => {
		await paused;
		await route.continue();
	});
	await page.goto("/?windowType=editor", { waitUntil: "domcontentloaded" });
	await expect(page.locator(".boot-shell")).toHaveCount(0);
	await expect(page.getByRole("status", { name: "Loading editor" })).toBeVisible();
	release();
	await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
	await expect(page.getByRole("status", { name: "Loading editor" })).toHaveCount(0);
});
