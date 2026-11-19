import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

for (const webcam of [false, true]) {
	test(`dragging the ${webcam ? "docked" : "standalone"} pill moves smoothly without stealing button clicks`, async ({
		page,
	}) => {
		await installDesktopBridge(page);
		await page.addInitScript((webcam) => {
			window.electronAPI.getRecordingPreferences = async () => ({
				success: true,
				webcamEnabled: webcam,
				microphoneEnabled: false,
				systemAudioEnabled: false,
			});
			window.electronAPI.onRecordingStateChanged = (callback) => {
				const listener = () =>
					callback({ recording: true, sourceName: "Built-in Display" });
				window.addEventListener("test-recording", listener);
				return () => window.removeEventListener("test-recording", listener);
			};
			window.electronAPI.hudOverlayHide = async () => {
				document.documentElement.dataset.hudHidden = "true";
				return { success: true };
			};
		}, webcam);
		await page.goto("/?windowType=hud-overlay");
		await expect(
			page.getByRole("group", { name: "Recording setup", exact: true }),
		).toBeVisible();
		if (webcam) await expect(page.locator("[data-floating-webcam-preview]")).toBeVisible();
		await page.evaluate(() => window.dispatchEvent(new Event("test-recording")));
		const controls = page.getByRole("group", { name: "Recording controls", exact: true });
		const bar = page.locator("[data-recording-state]");
		await expect(controls).toBeVisible();
		await expect
			.poll(() =>
				bar.evaluate(
					(node) =>
						node
							.getAnimations({ subtree: true })
							.filter((animation) => animation.playState === "running").length,
				),
			)
			.toBe(0);
		const before = (await bar.boundingBox())!;
		const cameraBefore = webcam
			? (await page.locator("[data-floating-webcam-preview]").boundingBox())!
			: null;
		const timer = (await page.getByRole("timer").boundingBox())!;
		const start = { x: timer.x + 12, y: timer.y + timer.height / 2 };
		await page.mouse.move(start.x, start.y);
		await page.mouse.down();
		await page.mouse.move(start.x + 2, start.y + 2);
		await page.mouse.up();
		expect(await bar.boundingBox()).toEqual(before);
		await page.mouse.move(start.x, start.y);
		await page.mouse.down();
		await page.mouse.move(start.x + 100, start.y - 80, { steps: 6 });
		await page.mouse.up();
		const moved = (await bar.boundingBox())!;
		expect(moved.x).toBeCloseTo(before.x + 100);
		expect(moved.y).toBeCloseTo(before.y - 80);
		if (cameraBefore) {
			const camera = (await page.locator("[data-floating-webcam-preview]").boundingBox())!;
			expect(camera.x).toBeCloseTo(cameraBefore.x + 100);
			expect(camera.y).toBeCloseTo(cameraBefore.y - 80);
		}
		await page.getByRole("button", { name: /Hide/ }).click();
		await expect(page.locator("html")).toHaveAttribute("data-hud-hidden", "true");
		expect(await bar.boundingBox()).toEqual(moved);
		const updatedTimer = (await page.getByRole("timer").boundingBox())!;
		await page.mouse.move(updatedTimer.x + 10, updatedTimer.y + 5);
		await page.mouse.down();
		await page.mouse.move(updatedTimer.x + 50, updatedTimer.y - 35, { steps: 4 });
		await page.evaluate(() => window.dispatchEvent(new Event("blur")));
		const interrupted = (await bar.boundingBox())!;
		await page.mouse.move(0, 0);
		await page.mouse.up();
		expect(await bar.boundingBox()).toEqual(interrupted);
		await expect(page.locator("html")).not.toHaveAttribute(
			"data-webcam-preview-cursor",
			"grabbing",
		);
		const lastTimer = (await page.getByRole("timer").boundingBox())!;
		const beforeCancel = (await bar.boundingBox())!;
		await page.mouse.move(lastTimer.x + 10, lastTimer.y + 5);
		await page.mouse.down();
		await page.mouse.move(lastTimer.x + 70, lastTimer.y - 45, { steps: 4 });
		await bar.evaluate((node) =>
			node.dispatchEvent(
				new PointerEvent("pointercancel", {
					pointerId: 1,
					bubbles: true,
					clientX: 0,
					clientY: 0,
				}),
			),
		);
		const cancelled = (await bar.boundingBox())!;
		expect(cancelled.x).toBeCloseTo(beforeCancel.x + 60);
		expect(cancelled.y).toBeCloseTo(beforeCancel.y - 50);
		await page.mouse.move(0, 0);
		await page.mouse.up();
		expect(await bar.boundingBox()).toEqual(cancelled);
	});
}
