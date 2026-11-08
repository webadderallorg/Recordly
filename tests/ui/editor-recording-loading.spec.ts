import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

for (const reducedMotion of ["no-preference", "reduce"] as const) {
	for (const failure of [false, true]) {
		test(`recording opens the editor skeleton before media finishes${failure ? " and surfaces failures" : ""} (${reducedMotion})`, async ({
			page,
		}) => {
			test.setTimeout(120000);
			await page.emulateMedia({ reducedMotion });
			await installDesktopBridge(page);
			await page.addInitScript(() => {
				let complete!: (result: { error?: string }) => void;
				const ready = new Promise<{ error?: string }>((resolve) => {
					complete = resolve;
				});
				Object.assign(window, { finishTestRecording: complete });
				Object.assign(window.electronAPI, {
					getEditorStartupView: () => "editor",
					waitForRecordingEditor: () => {
						document.documentElement.dataset.recordingAwait = "true";
						return ready;
					},
				});
			});
			await page.goto("/?windowType=editor");
			await expect(page.locator("html")).toHaveAttribute("data-recording-await", "true", {
				timeout: 60000,
			});
			await expect(page.getByRole("status", { name: "Loading editor" })).toBeVisible();
			const mark = page.locator(".loading-recordly-mark");
			await expect(mark).toBeVisible();
			const markBounds = (await mark.boundingBox())!;
			const previewBounds = (await page.locator(".loading-preview-frame").boundingBox())!;
			expect(
				Math.abs(
					markBounds.x + markBounds.width / 2 - previewBounds.x - previewBounds.width / 2,
				),
			).toBeLessThan(1);
			expect(
				Math.abs(
					markBounds.y +
						markBounds.height / 2 -
						previewBounds.y -
						previewBounds.height / 2,
				),
			).toBeLessThan(1);
			expect(await mark.evaluate((node) => node.getAnimations().length)).toBe(
				reducedMotion === "reduce" ? 0 : 1,
			);
			await expect(page.getByText("Preparing recording", { exact: true })).toHaveCount(0);
			await page.evaluate((failure) => {
				(
					window as unknown as {
						finishTestRecording: (result: { error?: string }) => void;
					}
				).finishTestRecording(failure ? { error: "Recording interrupted" } : {});
			}, failure);
			if (failure) {
				const errorDialog = page.getByRole("dialog", {
					name: "We couldn’t open this file",
					exact: true,
				});
				await expect(errorDialog).toBeVisible();
				const details = page.locator("details").filter({
					has: page.getByText("Technical details", { exact: true }),
				});
				await expect(details.getByText(/Recording interrupted/)).not.toBeVisible();
				await details.locator("summary").click();
				await expect(details.getByText(/Recording interrupted/)).toBeVisible();
				await errorDialog.getByRole("button", { name: "Close", exact: true }).click();
				await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
			} else {
				await expect(page.getByRole("navigation", { name: "Editor tools" })).toBeVisible({
					timeout: 30000,
				});
				await expect
					.poll(
						() =>
							page
								.locator("video")
								.evaluateAll((videos) =>
									videos.some((video) => video.readyState >= 2),
								),
						{ timeout: 30000 },
					)
					.toBe(true);
			}
			await expect(page.getByRole("status", { name: "Loading editor" })).toHaveCount(0);
		});
	}
}
