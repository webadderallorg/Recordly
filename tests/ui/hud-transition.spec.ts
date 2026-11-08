import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

for (const reducedMotion of ["reduce", "no-preference"] as const) {
	test(`HUD morphs between ready and recording with ${reducedMotion} motion`, async ({
		page,
	}) => {
		await page.emulateMedia({ reducedMotion });
		await installDesktopBridge(page);
		await page.addInitScript(() => {
			window.electronAPI.onRecordingStateChanged = (callback) => {
				const listener = (event: Event) =>
					callback({
						recording: (event as CustomEvent).detail,
						sourceName: "Built-in Display",
					});
				window.addEventListener("test-recording", listener);
				return () => window.removeEventListener("test-recording", listener);
			};
		});
		await page.goto("/?windowType=hud-overlay");
		await expect(
			page.getByRole("group", { name: "Recording setup", exact: true }),
		).toBeVisible();
		const result = await page.evaluate(() => {
			window.dispatchEvent(new CustomEvent("test-recording", { detail: true }));
			return new Promise<{
				animations: number;
				from: string | number | null | undefined;
				to: string | number | null | undefined;
			}>((resolve) =>
				requestAnimationFrame(() => {
					const bar = document.querySelector<HTMLElement>(
						"[data-recording-state=recording]",
					)!;
					const animations = bar.getAnimations();
					const frames = (
						animations[0]?.effect as KeyframeEffect | undefined
					)?.getKeyframes();
					resolve({
						animations: animations.length,
						from: frames?.[0]?.width,
						to: frames?.[1]?.width,
					});
				}),
			);
		});
		if (reducedMotion === "reduce") expect(result.animations).toBe(0);
		else {
			expect(result.animations).toBe(1);
			expect(Number.parseFloat(String(result.from))).toBeGreaterThan(
				Number.parseFloat(String(result.to)),
			);
		}
		const bar = page.locator("[data-recording-state]");
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
		const stop = page.getByRole("button", { name: "Stop", exact: true });
		const red = await stop.locator("span").evaluate((node) => {
			const context = document.createElement("canvas").getContext("2d")!;
			context.fillStyle = getComputedStyle(node).backgroundColor;
			context.fillRect(0, 0, 1, 1);
			return [...context.getImageData(0, 0, 1, 1).data];
		});
		expect(red[0]).toBeGreaterThan(red[1] + 50);
		expect(red[0]).toBeGreaterThan(red[2] + 50);
		await page.evaluate(() =>
			window.dispatchEvent(new CustomEvent("test-recording", { detail: false })),
		);
		await expect(
			page.getByRole("group", { name: "Recording setup", exact: true }),
		).toBeVisible();
	});
}
