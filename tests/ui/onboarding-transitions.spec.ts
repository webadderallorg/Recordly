import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

for (const [width, height] of [[760, 760], [600, 600], [420, 760], [390, 760], [390, 540]]) {
	for (const reducedMotion of ["no-preference", "reduce"] as const) {
		test(`onboarding keeps its frame through both transitions and permission loading (${reducedMotion}, ${width}x${height})`, async ({
			page,
		}) => {
			await page.setViewportSize({ width, height });
			await page.emulateMedia({ reducedMotion });
			await installDesktopBridge(page, "preview.mp4", { signedIn: false });
			await installDesktopBridgeOverrides(page, () => {
				const ready = new Promise<void>((resolve) => {
					Object.assign(window, { finishPermissionCheck: resolve });
				});
				window.electronAPI.getScreenRecordingPermissionStatus = async () => {
					document.documentElement.dataset.permissionCheckStarted = "true";
					await ready;
					return { success: true, status: "granted" };
				};
			});
			await page.goto("/?windowType=onboarding&onboardingPreview=1");
			const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
			const artwork = tour.locator("[data-onboarding-artwork]");
			await expect.poll(() => artwork.evaluate((element) =>
				new DOMMatrixReadOnly(getComputedStyle(element).transform).isIdentity,
			)).toBe(true);
			await expect(tour.getByPlaceholder("you@example.com")).toBeVisible();
			const initialHeading = (await tour.getByRole("heading", { level: 2 }).boundingBox())!;
			if (reducedMotion === "no-preference")
				await tour.screenshot({ path: test.info().outputPath("account.png") });
			const initialFrame = await artwork.evaluate((element) => {
				const content = element.nextElementSibling!;
				const layout = element.parentElement!;
				const samples: number[][] = [];
				let frame = 0;
				const sample = () => {
					const footer = layout.querySelector(".onboarding-footer")!.getBoundingClientRect();
					samples.push([
						content.clientHeight,
						content.getBoundingClientRect().y,
						element.clientHeight,
						footer.y,
						footer.height,
						layout.querySelector(".onboarding-navigation")!.getBoundingClientRect().y,
					]);
					frame = requestAnimationFrame(sample);
				};
				sample();
				Object.assign(window, {
					finishTransitionSamples: () => {
						cancelAnimationFrame(frame);
						return samples;
					},
				});
				return samples[0];
			});
			await tour.getByRole("button", { name: "Continue", exact: true }).click();
			await expect(page.locator("html")).toHaveAttribute(
				"data-permission-check-started",
				"true",
			);
			// Hold the IPC response beyond the page entrance to expose loading-layout shifts.
			const loadingHeight = await artwork.evaluate(async (element) => {
				const start = performance.now();
				while (performance.now() - start < 650) {
					await new Promise(requestAnimationFrame);
				}
				return element.clientHeight;
			});
			const loadingContentHeight = await artwork.evaluate(
				(element) => element.nextElementSibling!.clientHeight,
			);
			expect(Math.abs(loadingContentHeight - initialFrame[0])).toBeLessThanOrEqual(1);
			await expect(
				tour.getByRole("button", { name: "Start recording", exact: true }),
			).toBeDisabled();
			await page.evaluate(() => {
				(
					window as unknown as { finishPermissionCheck: () => void }
				).finishPermissionCheck();
			});
			await expect(tour.getByText("Allowed", { exact: true })).toHaveCount(2);
			await expect(
				tour.getByRole("button", { name: "Start recording", exact: true }),
			).toBeEnabled();
			const loadedHeight = await artwork.evaluate((element) => element.clientHeight);
			expect(Math.abs(loadedHeight - loadingHeight)).toBeLessThanOrEqual(1);
			const permissionHeading = (await tour.getByRole("heading", { level: 2 }).boundingBox())!;
			expect(Math.abs(permissionHeading.y - initialHeading.y)).toBeLessThanOrEqual(1);
			if (reducedMotion === "no-preference") {
				await tour.screenshot({ path: test.info().outputPath(`permissions-${width}.png`) });
			}
			await tour.getByRole("button", { name: "Back to account" }).click();
			await expect(tour.getByPlaceholder("you@example.com")).toBeVisible();
			const samples = await page.evaluate(async () => {
				const start = performance.now();
				while (performance.now() - start < 650) await new Promise(requestAnimationFrame);
				return (window as unknown as { finishTransitionSamples: () => number[][] }).finishTransitionSamples();
			});
			await test.info().attach("frame-positions", {
				body: JSON.stringify({ initialFrame, samples }),
				contentType: "application/json",
			});
			for (let metric = 0; metric < initialFrame.length; metric++) {
				expect(Math.max(...samples.map((sample) => Math.abs(sample[metric] - initialFrame[metric])))).toBeLessThanOrEqual(1);
			}
		});
	}
}
