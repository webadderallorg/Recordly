import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("selecting an untouched clip does not introduce a leading gap", async ({ page }) => {
	test.setTimeout(120000);
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.onMenuSaveProject = (callback) => {
			const handler = () => {
				void callback();
			};
			window.addEventListener("test-save-project", handler);
			return () => window.removeEventListener("test-save-project", handler);
		};
		window.electronAPI.saveProjectFile = async (project) => {
			sessionStorage.setItem("test-saved-clips", JSON.stringify(project.editor.clipRegions));
			return { success: false, canceled: true };
		};
	});
	await page.goto("/?windowType=editor");
	const clip = page.locator('[data-timeline-item][data-variant="clip"]');
	await expect(clip).toBeVisible({ timeout: 20000 });
	await expect(clip).toHaveCSS("left", "0px");
	for (let index = 0; index < 5; index++) {
		const box = (await clip.boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2);
		await page.mouse.up();
		await expect(clip).toHaveCSS("left", "0px");
	}
	// A click on the resize edge must not trim source footage either.
	const originalWidth = (await clip.boundingBox())!.width;
	const box = (await clip.boundingBox())!;
	await page.mouse.move(box.x + 8, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + 9, box.y + box.height / 2);
	await page.mouse.up();
	await expect(clip).toHaveCSS("left", "0px");
	expect((await clip.boundingBox())!.width).toBeCloseTo(originalWidth, 1);
	await page.evaluate(() => {
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true,
			path: "/test.recordly",
		});
		window.dispatchEvent(new Event("test-save-project"));
	});
	await expect
		.poll(() => page.evaluate(() => sessionStorage.getItem("test-saved-clips")), {
			timeout: 20000,
		})
		.not.toBeNull();
	const clips = await page.evaluate(() =>
		JSON.parse(sessionStorage.getItem("test-saved-clips")!),
	);
	expect(clips).toHaveLength(1);
	expect(clips[0]).toMatchObject({ startMs: 0, endMs: 6000, speed: 1 });
	expect(clips[0].sourceStartMs ?? clips[0].startMs).toBe(0);
	// A lone clip stays packed at zero even after an intentional drag.
	const dragBox = (await clip.boundingBox())!;
	const dragX = dragBox.x + dragBox.width / 2;
	const dragY = dragBox.y + dragBox.height / 2;
	await page.mouse.move(dragX, dragY);
	await page.mouse.down();
	await page.mouse.move(dragX + 40, dragY, { steps: 8 });
	await page.mouse.up();
	await expect(clip).toHaveCSS("left", "0px");
	await expect(clip).toHaveAttribute("data-start-ms", "0");
	await expect(clip).toHaveAttribute("data-end-ms", "6000");

	await page.getByRole("button", { name: "Export", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Export", exact: true });
	const dialogBox = (await dialog.boundingBox())!;
	const titleBox = (await dialog
		.getByRole("heading", { name: "Export", exact: true })
		.boundingBox())!;
	expect(titleBox.x - dialogBox.x).toBeGreaterThanOrEqual(16);
	expect(titleBox.y - dialogBox.y).toBeGreaterThanOrEqual(16);
	await page.screenshot({
		path: "test-results/export-padding-restored.png",
		animations: "disabled",
	});
});
