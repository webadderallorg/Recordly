import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

async function observeTransition(page: Page, recording: boolean) {
	return page.locator("[data-recording-state]").evaluate(
		(node, recording) =>
			new Promise<{ center: number; cameraX?: number; cameraY?: number }[]>((resolve) => {
				const samples: { center: number; cameraX?: number; cameraY?: number }[] = [];
				const observer = new ResizeObserver(() => {
					const bounds = node.getBoundingClientRect();
					const camera = document
						.querySelector("[data-floating-webcam-preview]")
						?.getBoundingClientRect();
					samples.push({
						center: bounds.left + bounds.width / 2,
						cameraX: camera?.left,
						cameraY: camera?.top,
					});
				});
				observer.observe(node);
				window.dispatchEvent(new CustomEvent("test-recording", { detail: recording }));
				setTimeout(() => {
					observer.disconnect();
					resolve(samples);
				}, 400);
			}),
		recording,
	);
}

for (const scenario of [
	{ webcam: false, viewport: 1440 },
	{ webcam: true, viewport: 1440 },
	{ webcam: true, viewport: 1280 },
	{ webcam: true, viewport: 600 },
]) {
	test(`HUD alone stays centered from setup through recording (${JSON.stringify(scenario)})`, async ({
		page,
	}) => {
		await page.setViewportSize({ width: scenario.viewport, height: 1000 });
		await installDesktopBridge(page);
		await page.addInitScript(({ webcam }) => {
			window.electronAPI.getRecordingPreferences = async () => ({
				success: true,
				webcamEnabled: webcam,
				microphoneEnabled: false,
				systemAudioEnabled: false,
			});
			window.electronAPI.onRecordingStateChanged = (callback) => {
				const listener = (event: Event) =>
					callback({
						recording: (event as CustomEvent).detail,
						sourceName: "Built-in Display",
					});
				window.addEventListener("test-recording", listener);
				return () => window.removeEventListener("test-recording", listener);
			};
		}, scenario);
		await page.goto("/?windowType=hud-overlay");
		const bar = page.locator("[data-recording-state]");
		await expect(
			page.getByRole("group", { name: "Recording setup", exact: true }),
		).toBeVisible();
		if (scenario.webcam)
			await expect(page.locator("[data-floating-webcam-preview]")).toBeVisible();
		const ready = (await bar.boundingBox())!;
		const cameraBefore = scenario.webcam
			? await page.locator("[data-floating-webcam-preview]").boundingBox()
			: null;
		expect(ready.x + ready.width / 2).toBeCloseTo(scenario.viewport / 2);
		expect(ready.y + ready.height).toBeCloseTo(968);
		const radius = await bar.evaluate((node) => getComputedStyle(node).borderRadius);
		expect(radius).toBe("999px");
		const samples = await observeTransition(page, true);
		for (const sample of samples) {
			expect(sample.center).toBeCloseTo(scenario.viewport / 2, 0);
			if (cameraBefore) {
				expect(sample.cameraX).toBeCloseTo(cameraBefore.x);
				expect(sample.cameraY).toBeCloseTo(cameraBefore.y);
			}
		}
		const recording = (await bar.boundingBox())!;
		expect(recording.x + recording.width / 2).toBeCloseTo(scenario.viewport / 2);
		expect(recording.y + recording.height).toBeCloseTo(ready.y + ready.height);
		await expect(bar).toHaveCSS("border-radius", radius);
		const cameraBeforeReturn = scenario.webcam
			? await page.locator("[data-floating-webcam-preview]").boundingBox()
			: null;
		const returnSamples = await observeTransition(page, false);
		for (const sample of returnSamples) {
			expect(sample.center).toBeCloseTo(scenario.viewport / 2, 0);
			if (cameraBeforeReturn) {
				expect(sample.cameraX).toBeCloseTo(cameraBeforeReturn.x);
				expect(sample.cameraY).toBeCloseTo(cameraBeforeReturn.y);
			}
		}
		await expect
			.poll(async () => {
				const bounds = (await bar.boundingBox())!;
				return Math.abs(bounds.x + bounds.width / 2 - scenario.viewport / 2);
			})
			.toBeLessThan(0.5);
		if (scenario.webcam) {
			await observeTransition(page, true);
			const camera = page.locator("[data-floating-webcam-preview]");
			const origin = (await camera.boundingBox())!;
			await page.mouse.move(origin.x + origin.width / 2, origin.y + origin.height / 2);
			await page.mouse.down();
			await page.mouse.move(scenario.viewport - 1, origin.y + origin.height / 2, {
				steps: 5,
			});
			await page.mouse.up();
			const atEdge = (await camera.boundingBox())!;
			for (const recording of [false, true]) {
				const edgeSamples = await observeTransition(page, recording);
				for (const sample of edgeSamples) {
					expect(sample.cameraX).toBeCloseTo(atEdge.x);
					expect(sample.cameraY).toBeCloseTo(atEdge.y);
				}
			}
		}
	});
}
