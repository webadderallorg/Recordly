import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("feedback preserves a draft on failure, supports attachments, and includes diagnostics automatically", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Feedback", exact: true }).click();
	const modal = page.getByRole("dialog", { name: "Send feedback", exact: true });
	await modal.getByLabel("Subject", { exact: true }).fill("Export stops early");
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
	await expect(
		modal.getByText("Diagnostics will be sent along with your feedback."),
	).toBeVisible();
	await expect(modal.getByRole("checkbox")).toHaveCount(0);
	await expect(modal.getByLabel("Title", { exact: true })).toHaveCount(0);
	await modal.getByRole("button", { name: "Send feedback", exact: true }).click();
	await expect(modal.getByRole("alert")).toHaveText("Could not send feedback. Please try again.");
	await expect(modal.getByLabel("Subject", { exact: true })).toHaveValue("Export stops early");
	await modal.getByLabel("Subject", { exact: true }).fill("Export stops early (updated)");
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
		.getByRole("button", { name: "Feedback", exact: true })
		.click();
	await expect(page.getByRole("dialog", { name: "Send feedback", exact: true })).toBeVisible();
});
