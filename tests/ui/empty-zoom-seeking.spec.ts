import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function installAutoZoomBridge(page: Page) {
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getCursorTelemetry = async () => ({
			success: true,
			samples: [
				{ timeMs: 0, cx: 0.2, cy: 0.5, interactionType: "move" },
				{ timeMs: 6000, cx: 0.8, cy: 0.5, interactionType: "move" },
			],
		});
	});
}

test("empty zoom row seeks and scrubs without adding zooms", async ({ page }) => {
	test.setTimeout(90000);
	await installAutoZoomBridge(page);
	await page.goto("/?windowType=editor");
	const apply = page.getByRole("button", { name: "Apply auto zooms", exact: true });
	await expect(apply).toBeVisible({ timeout: 20000 });
	const row = page.locator('[data-timeline-row="row-zoom"]');
	const bounds = (await row.boundingBox())!;
	const playhead = page.getByTestId("timeline-playhead").locator(":scope > div");
	const firstX = bounds.x + bounds.width * 0.2;
	const lastX = bounds.x + bounds.width * 0.8;
	const y = bounds.y + bounds.height / 2;
	const expectPlayheadAt = async (x: number) => {
		await expect
			.poll(async () => Math.abs((await playhead.boundingBox())!.x - x))
			.toBeLessThan(2);
	};

	await page.mouse.click(firstX, y);
	await expectPlayheadAt(firstX);
	await expect(row.getByTestId("timeline-add-preview")).toHaveCount(0);
	await page.mouse.down();
	await page.mouse.move(lastX, y, { steps: 3 });
	await expectPlayheadAt(lastX);
	// A scrub keeps tracking after leaving the row and ends on mouseup.
	await page.mouse.move(firstX, bounds.y - 10, { steps: 3 });
	await page.mouse.up();
	await expectPlayheadAt(firstX);
	await page.mouse.move(lastX, y);
	await expectPlayheadAt(firstX);
	await expect(page.locator('[data-variant="zoom"]')).toHaveCount(0);

	// The button handles its own click without moving the playhead.
	await apply.click();
	await expect(
		page.getByText("No clear interaction moments found", { exact: true }),
	).toBeVisible();
	await expectPlayheadAt(firstX);
	await expect(page.locator('[data-variant="zoom"]')).toHaveCount(0);
	await expect(apply).toBeVisible({ timeout: 20000 });
});

test("dismissing the inline auto-zoom prompt restores manual hover placement", async ({ page }) => {
	await installAutoZoomBridge(page);
	await page.goto("/?windowType=editor");
	const apply = page.getByRole("button", { name: "Apply auto zooms", exact: true });
	await expect(apply).toBeVisible({ timeout: 20000 });
	const dismiss = page.getByRole("button", { name: "Dismiss", exact: true });
	await apply.locator("..").evaluate((element) => {
		for (const animation of element.getAnimations()) {
			animation.pause();
			animation.currentTime = 600;
		}
	});
	const applyBounds = (await apply.boundingBox())!;
	const dismissBounds = (await dismiss.boundingBox())!;
	// The minus stays inside the one Apply button silhouette, without an outer pill.
	expect(dismissBounds.x).toBeGreaterThanOrEqual(applyBounds.x);
	expect(dismissBounds.x + dismissBounds.width).toBeLessThanOrEqual(
		applyBounds.x + applyBounds.width + 1,
	);
	expect(
		Math.abs(
			applyBounds.y + applyBounds.height / 2 - dismissBounds.y - dismissBounds.height / 2,
		),
	).toBeLessThan(1);
	const row = page.locator('[data-timeline-row="row-zoom"]');
	const bounds = (await row.boundingBox())!;
	const x = bounds.x + bounds.width * 0.25;
	const y = bounds.y + bounds.height / 2;
	await page.mouse.move(x, y);
	await expect(row.getByTestId("timeline-add-preview")).toHaveCount(0);
	await dismiss.click();
	await expect(apply).toHaveCount(0);
	await page.mouse.move(x, y);
	await expect(row.getByTestId("timeline-add-preview")).toBeVisible();
	await page.mouse.click(x, y);
	const zoom = page.locator('[data-variant="zoom"]');
	await expect(zoom).toHaveCount(1);
	await zoom.click();
	await page.keyboard.press("Backspace");
	await expect(zoom).toHaveCount(0);
	await expect(apply).toHaveCount(0);
	await page.mouse.move(x + 20, y);
	await expect(row.getByTestId("timeline-add-preview")).toBeVisible();
});

test("removing the last zoom shows the apply prompt unless explicitly dismissed", async ({
	page,
}) => {
	await installAutoZoomBridge(page);
	await page.goto("/?windowType=editor");
	const apply = page.getByRole("button", { name: "Apply auto zooms", exact: true });
	await expect(apply).toBeVisible({ timeout: 20000 });
	await page.getByRole("button", { name: "Add Zoom (Z)", exact: true }).click();
	const zoom = page.locator('[data-variant="zoom"]');
	await expect(zoom).toHaveCount(1);
	await expect(apply).toHaveCount(0);
	await zoom.click();
	await page.keyboard.press("Backspace");
	await expect(zoom).toHaveCount(0);
	await expect(apply).toBeVisible({ timeout: 20000 });
});

test("loaded-empty cursor telemetry leaves manual zoom placement available", async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	const row = page.locator('[data-timeline-row="row-zoom"]');
	await expect(row).toBeVisible({ timeout: 20000 });
	await expect(page.getByRole("button", { name: "Apply auto zooms", exact: true })).toHaveCount(
		0,
	);
	const bounds = (await row.boundingBox())!;
	const x = bounds.x + bounds.width * 0.25;
	const y = bounds.y + bounds.height / 2;
	await page.mouse.move(x, y);
	await expect(row.getByTestId("timeline-add-preview")).toBeVisible();
	await page.mouse.click(x, y);
	await expect(page.locator('[data-variant="zoom"]')).toHaveCount(1);
});

test("pending telemetry keeps manual placement available and enables auto zoom only after it arrives", async ({
	page,
}) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getCursorTelemetry = async () => {
			await new Promise<void>((resolve) => {
				Object.assign(window, { releaseZoomTelemetry: resolve });
			});
			return {
				success: true,
				samples: [
					{ timeMs: 0, cx: 0.5, cy: 0.5, interactionType: "move" },
					{ timeMs: 2000, cx: 0.5, cy: 0.5, interactionType: "click" },
					{ timeMs: 2050, cx: 0.5, cy: 0.5, interactionType: "mouseup" },
					{ timeMs: 6000, cx: 0.5, cy: 0.5, interactionType: "move" },
				],
			};
		};
	});
	await page.goto("/?windowType=editor");
	const row = page.locator('[data-timeline-row="row-zoom"]');
	await expect(row).toBeVisible({ timeout: 20000 });
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					typeof (window as unknown as { releaseZoomTelemetry?: unknown })
						.releaseZoomTelemetry,
			),
		)
		.toBe("function");
	const apply = page.getByRole("button", { name: "Apply auto zooms", exact: true });
	await expect(apply).toHaveCount(0);
	const bounds = (await row.boundingBox())!;
	await page.mouse.move(bounds.x + bounds.width * 0.25, bounds.y + bounds.height / 2);
	await expect(row.getByTestId("timeline-add-preview")).toBeVisible();
	await page.getByRole("button", { name: "Suggest Zooms from Cursor", exact: true }).click();
	await expect(page.locator('[data-variant="zoom"]')).toHaveCount(0);
	await page.evaluate(() => {
		(window as unknown as { releaseZoomTelemetry(): void }).releaseZoomTelemetry();
	});
	await expect(apply).toBeVisible();
	await apply.click();
	await expect(page.locator('[data-variant="zoom"]')).toHaveCount(1);
});
