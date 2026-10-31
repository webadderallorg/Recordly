import { expect, test } from "@playwright/test";

test("export reports preview only technical data and submit explicitly without account identity", async ({
	page,
}) => {
	const reports: unknown[] = [];
	await page.route("**/functions/v1/submit-export-error", async (route) => {
		const req = route.request();
		expect(req.headers().authorization).toBeUndefined();
		expect(req.headers().cookie).toBeUndefined();
		expect(req.headers().referer).toBeUndefined();
		reports.push(req.postDataJSON());
		await route.fulfill({
			status: reports.length === 1 ? 500 : 200,
			contentType: "application/json",
			body: JSON.stringify(
				reports.length === 1 ? { code: "SUBMISSION_FAILED" } : { success: true },
			),
		});
	});
	await page.goto("/tests/ui/export-error-report.html");
	await page.getByRole("button", { name: "Report error", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Report export error", exact: true });
	await expect(dialog).toBeVisible();
	expect(reports).toHaveLength(0);
	await dialog.getByText("View data to be sent", { exact: true }).click();
	await expect(dialog.locator("pre")).toContainText("VIDEO_DECODE_ENCODING_ERROR");
	await expect(dialog.locator("pre")).not.toContainText("Alice");
	await dialog.getByLabel("Cloud plan", { exact: false }).selectOption("paid");
	await expect(dialog.locator("pre")).toContainText('"cloudPlan": "paid"');
	await page.screenshot({ path: "test-results/export-error-report.png" });
	await dialog.getByRole("button", { name: "Send report", exact: true }).click();
	await expect(dialog.getByRole("alert")).toContainText("Could not send");
	expect(reports).toHaveLength(1);
	await dialog.getByRole("button", { name: "Send report", exact: true }).click();
	await expect(page.getByRole("dialog", { name: "Report sent", exact: true })).toBeVisible();
	expect(reports).toHaveLength(2);
	expect(reports[1]).toMatchObject({ cloudPlan: "paid", format: "mp4" });
});
