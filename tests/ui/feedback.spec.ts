import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("feedback preserves a draft on failure, supports attachments, and includes diagnostics automatically", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Recordly account", exact: true }).click();
	await page
		.getByRole("dialog", { name: "Account menu", exact: true })
		.getByRole("button", { name: "Feedback", exact: true })
		.click();
	const modal = page.getByRole("dialog", { name: "Send feedback", exact: true });
	await expect(modal.getByLabel("Subject", { exact: true })).toHaveCount(0);
	await expect(modal.locator("label")).toHaveCount(0);
	await modal.getByRole("button", { name: "Loving", exact: true }).click();
	await modal.getByRole("button", { name: "Angry", exact: true }).click();
	await expect(modal.getByRole("button", { name: "Loving", exact: true })).toHaveAttribute(
		"aria-pressed",
		"false",
	);
	await modal
		.getByLabel("Description", { exact: true })
		.fill("Export stopped before the last frame.");
	await modal.getByLabel("Attach files", { exact: true }).setInputFiles({
		name: "notes.txt",
		mimeType: "text/plain",
		buffer: Buffer.from("Reproduction steps"),
	});
	await expect(modal.getByText("notes.txt", { exact: true })).toBeVisible();
	await modal.getByRole("button", { name: "Remove notes.txt" }).click();
	await expect(modal.getByText("notes.txt", { exact: true })).toHaveCount(0);
	await expect(modal.getByText("Relevant diagnostic logs will be attached.")).toBeVisible();
	await expect(modal.getByRole("checkbox")).toHaveCount(0);
	await expect(modal.getByLabel("Title", { exact: true })).toHaveCount(0);
	await modal.getByRole("button", { name: "Send feedback", exact: true }).click();
	await expect(modal.getByRole("alert")).toHaveText(
		"Could not send feedback. Please try again. Report error",
	);
	await expect(
		modal.getByRole("alert").getByRole("button", { name: "Report error", exact: true }),
	).toBeVisible();
	await expect(modal.getByRole("button", { name: "Angry", exact: true })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await modal.getByLabel("Description", { exact: true }).fill("Export stops early (updated)");
	await expect(modal.getByRole("alert")).toHaveCount(0);
	await modal.getByRole("button", { name: "Send feedback", exact: true }).click();
	await expect(modal.getByRole("alert")).toBeVisible();
	await modal.getByLabel("Description", { exact: true }).fill("Updated reproduction steps.");
	await expect(modal.getByRole("alert")).toHaveCount(0);
	await page.screenshot({ path: "test-results/feedback.png" });
	await modal.getByRole("button", { name: "Close", exact: true }).click();
	await page.getByRole("button", { name: "Home", exact: true }).click();
	await page
		.getByRole("dialog", { name: "Projects dashboard", exact: true })
		.getByRole("button", { name: "Recordly account" })
		.click();
	await page
		.getByRole("dialog", { name: "Account menu", exact: true })
		.getByRole("button", { name: "Feedback", exact: true })
		.click();
	await expect(page.getByRole("dialog", { name: "Send feedback", exact: true })).toBeVisible();
	await expect(modal.getByRole("button", { name: "Angry", exact: true })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await expect(modal.getByLabel("Description", { exact: true })).toHaveValue(
		"Updated reproduction steps.",
	);
});

test("feedback attaches saved export logs", async ({ page }) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		window.electronAPI.getExportDiagnostics = async () => ({
			success: true,
			logs: [
				'2026-10-18T08:00:00.000Z info: [export] failed {"encoderName":"Breeze","error":"Encoder stopped"}',
			],
		});
	});
	let requestBody = "";
	await page.route("**/functions/v1/submit-feedback", async (route) => {
		requestBody = route.request().postData() ?? "";
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({ success: true }),
		});
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Recordly account", exact: true }).click();
	await page
		.getByRole("dialog", { name: "Account menu", exact: true })
		.getByRole("button", { name: "Feedback", exact: true })
		.click();
	const modal = page.getByRole("dialog", { name: "Send feedback", exact: true });
	await modal.getByRole("button", { name: "Neutral", exact: true }).click();
	await modal
		.getByLabel("Description", { exact: true })
		.fill("The exporter stopped before completion.");
	await modal.getByRole("button", { name: "Send feedback", exact: true }).click();
	await expect(
		page.getByRole("dialog", { name: "Thanks for your feedback", exact: true }),
	).toBeVisible();
	expect(requestBody).toContain("😐 The exporter stopped before completion.");
	expect(requestBody).toContain('name="logs"');
	expect(requestBody).toContain("[export] failed");
	expect(requestBody).toContain("Breeze");
	expect(requestBody).toContain("Encoder stopped");
});
