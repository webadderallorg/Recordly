import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test.beforeEach(async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getEditorMode = async () => true;
		window.electronAPI.getRecordingPreferences = async () => ({
			success: true,
			microphoneEnabled: false,
			webcamEnabled: true,
			systemAudioEnabled: false,
		});
		document.addEventListener("pointerup", () => {
			document.documentElement.dataset.webcamReleasePassthrough =
				document.documentElement.dataset.webcamPassthrough;
		});
		document.addEventListener(
			"pointerdown",
			(event) => {
				document.documentElement.dataset.webcamPointerId = String(event.pointerId);
			},
			{ capture: true },
		);
		window.electronAPI.hudOverlaySetIgnoreMouse = (ignore) => {
			document.documentElement.dataset.webcamPassthrough = String(ignore);
		};
	});
	await page.goto("/?windowType=hud-overlay");
	await expect(page.locator("[data-floating-webcam-preview]")).toBeVisible();
});

test("camera stays interactive across consecutive drags and releases clicks outside it", async ({
	page,
}) => {
	const preview = page.locator("[data-floating-webcam-preview]");
	for (let index = 0; index < 2; index++) {
		const before = (await preview.boundingBox())!;
		const x = before.x + before.width / 2;
		const y = before.y + before.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x - 100, y - 60, { steps: 5 });
		await page.mouse.up();
		const after = (await preview.boundingBox())!;
		expect(after.x).toBeCloseTo(before.x - 100);
		expect(after.y).toBeCloseTo(before.y - 60);
		await expect(page.locator("html")).toHaveAttribute(
			"data-webcam-release-passthrough",
			"false",
		);
		await expect(page.locator("html")).toHaveAttribute("data-webcam-passthrough", "false");
	}
	await page.mouse.move(10, 10);
	await expect(page.locator("html")).toHaveAttribute("data-webcam-passthrough", "true");
});

test("quick release commits the last camera movement before the next animation frame", async ({
	page,
}) => {
	const preview = page.locator("[data-floating-webcam-preview]");
	const before = (await preview.boundingBox())!;
	const x = before.x + before.width / 2;
	const y = before.y + before.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.evaluate(() => {
		const original = window.requestAnimationFrame;
		window.requestAnimationFrame = () => 2147483647;
		window.addEventListener(
			"test-restore-frames",
			() => {
				window.requestAnimationFrame = original;
			},
			{ once: true },
		);
	});
	await page.mouse.move(x - 150, y - 90);
	await page.mouse.up();
	await page.evaluate(() => window.dispatchEvent(new Event("test-restore-frames")));
	const after = (await preview.boundingBox())!;
	expect(after.x).toBeCloseTo(before.x - 150);
	expect(after.y).toBeCloseTo(before.y - 90);
});

test("dragging past the viewport keeps the camera reachable and restores desktop clicks", async ({
	page,
}) => {
	const preview = page.locator("[data-floating-webcam-preview]");
	const before = (await preview.boundingBox())!;
	await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
	await page.mouse.down();
	await page.mouse.move(-100, -100, { steps: 5 });
	await page.mouse.up();
	const after = (await preview.boundingBox())!;
	expect(after.x).toBeCloseTo(0);
	expect(after.y).toBeCloseTo(0);
	await expect(page.locator("html")).toHaveAttribute("data-webcam-passthrough", "true");
});

test("camera has a fixed square size and keeps its drag cursor at the edges", async ({ page }) => {
	const preview = page.locator("[data-floating-webcam-preview]");
	const before = (await preview.boundingBox())!;
	expect([before.width, before.height]).toEqual([230, 230]);
	await expect(preview.locator("[data-resize-handle]")).toHaveCount(0);
	await page.mouse.move(before.x + 1, before.y + before.height / 2);
	await expect(page.locator("body")).toHaveCSS("cursor", "grab");
	await page.mouse.down();
	await page.mouse.move(before.x - 40, before.y + before.height / 2 - 30, { steps: 4 });
	await page.mouse.up();
	const after = (await preview.boundingBox())!;
	expect([after.width, after.height]).toEqual([230, 230]);
	expect(after.x).toBeLessThan(before.x);
	expect(after.y).toBeLessThan(before.y);
});
