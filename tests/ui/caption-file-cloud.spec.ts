import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function openCaptionExport(page: Page, mode: "free" | "pro", signedIn = true) {
	await installDesktopBridge(page, "preview.mp4", { signedIn });
	await installDesktopBridgeOverrides(
		page,
		({ mode }) => {
			localStorage.setItem(
				"recordly.editor.preferences",
				JSON.stringify({ includeCaptionSidecar: true }),
			);
			document.addEventListener("DOMContentLoaded", () => {
				document.documentElement.dataset.captionPlan = mode;
			});
			const prices = [{ interval: "monthly" as const, unitAmount: 900, currency: "usd" }];
			window.electronAPI.cloudBilling = async ({ action }) => {
				if (action === "catalog")
					return {
						success: true,
						prices,
						limits: {
							freeRecordingLimit: 5,
							freeMaxRecordingBytes: 1e9,
							plusMaxRecordingBytes: 1e10,
							storageLimitBytes: null,
						},
					};
				const plus = document.documentElement.dataset.captionPlan === "pro";
				return {
					success: true,
					billing: {
						plan: plus ? "pro" : "free",
						subscriptionStatus: plus ? "active" : null,
						currentPeriodEnd: null,
						cancelAtPeriodEnd: false,
						checkoutAvailable: !plus,
						checkoutIntervals: plus ? [] : ["monthly"],
						portalAvailable: plus,
						prices,
					},
					usage: {
						recordings: 0,
						recordingLimit: plus ? null : 5,
						maxRecordingBytes: plus ? 1e10 : 1e9,
						storageBytes: 0,
						storageLimitBytes: plus ? null : 1e11,
					},
				};
			};
			window.electronAPI.finalizeExportedVideo = async ({ captionSidecar }) => {
				document.documentElement.dataset.savedCaptionFiles = String(
					Boolean(captionSidecar),
				);
				return { success: true, path: "/saved/caption-test.mp4" };
			};
		},
		{ mode },
	);
	await page.goto("/tests/ui/export-resolution-presets.html?captions");
	await expect(page.getByTestId("caption-plan")).toHaveText(signedIn ? mode : "unverified");
	return page.getByRole("switch", { name: /^Export captions file/ });
}

for (const signedIn of [true, false]) {
	test(`${signedIn ? "Free" : "signed-out"} users see Cloud upgrade instead of enabling caption files`, async ({
		page,
	}) => {
		const toggle = await openCaptionExport(page, "free", signedIn);
		await expect(toggle).not.toBeChecked();
		await toggle.press("Space");
		const pricing = page.getByRole("dialog", { name: "Recordly Cloud", exact: true });
		await expect(pricing).toBeVisible();
		await expect(
			pricing.getByRole("list", { name: "Your Cloud benefits", exact: true }),
		).toContainText("SRT and VTT caption-file exports");
		await pricing.getByRole("button", { name: "Close", exact: true }).click();
		await expect(toggle).not.toBeChecked();
		await page.getByRole("button", { name: "Export Video", exact: true }).click();
		await expect(page.getByTestId("export-settings-result")).toContainText(
			'"includeCaptionSidecar":false',
		);
		await page.getByRole("button", { name: "Retry caption save", exact: true }).click();
		await expect(page.locator("html")).toHaveAttribute("data-saved-caption-files", "false");
	});
}

test("Cloud enables caption files, and losing access clears them from exports and retries", async ({
	page,
}) => {
	const toggle = await openCaptionExport(page, "pro");
	await expect(page.getByText("for commercial use", { exact: false })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Upgrade to Cloud", exact: true })).toHaveCount(0);
	await expect(toggle).toBeChecked();
	await toggle.press("Space");
	await expect(toggle).not.toBeChecked();
	await toggle.press("Space");
	await expect(toggle).toBeChecked();
	await page.getByRole("button", { name: "Export Video", exact: true }).click();
	await expect(page.getByTestId("export-settings-result")).toContainText(
		'"includeCaptionSidecar":true',
	);
	await page.getByRole("button", { name: "Retry caption save", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-saved-caption-files", "true");
	await page.screenshot({ path: test.info().outputPath("cloud-caption-export.png") });
	await page.evaluate(() => {
		document.documentElement.dataset.captionPlan = "free";
	});
	await page.getByRole("button", { name: "Refresh caption plan", exact: true }).click();
	await expect(page.getByTestId("caption-plan")).toHaveText("free");
	await expect(page.getByText("Upgrade to Cloud for commercial use", { exact: true })).toBeVisible();
	await expect(toggle).not.toBeChecked();
	await page.getByRole("button", { name: "Export Video", exact: true }).click();
	await expect(page.getByTestId("export-settings-result")).toContainText(
		'"includeCaptionSidecar":false',
	);
	await page.getByRole("button", { name: "Retry caption save", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-saved-caption-files", "false");
});
