import { expect, test } from "@playwright/test";

test("one click sends actual redacted logs, handles failure and retries without confirmation", async ({
	page,
}) => {
	const reports: Record<string, unknown>[] = [];
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
	expect(reports).toHaveLength(0);
	await page.getByRole("button", { name: "Report error", exact: true }).click();
	await expect(page.getByRole("status")).toContainText("Could not send");
	expect(reports).toHaveLength(1);
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await page.getByRole("button", { name: "Retry report", exact: true }).click();
	await expect(page.getByRole("button", { name: "Report sent", exact: true })).toBeDisabled();
	expect(reports).toHaveLength(2);
	expect(reports[1]).toMatchObject({ schemaVersion: 2, context: "export", format: "mp4" });
	expect(JSON.stringify(reports[1])).not.toContain("Alice");
	expect(JSON.stringify(reports[1])).not.toContain("alice@example.com");
	const logs = JSON.parse(reports[1].logs as string).logs;
	expect(logs.join("\n")).toContain("Report test: decoder log");
	await page.screenshot({ path: "test-results/error-report-sent.png" });
});

test("a crashed view can still send its error logs", async ({ page }) => {
	let report: { context?: string; logs?: string } = {};
	await page.route("**/functions/v1/submit-export-error", async (route) => {
		report = route.request().postDataJSON();
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: '{"success":true}',
		});
	});
	await page.goto("/tests/ui/export-error-report.html?crash");
	await expect(page.getByRole("heading", { name: "Recordly ran into a problem" })).toBeVisible();
	await page.getByRole("button", { name: "Report error", exact: true }).click();
	await expect(page.getByRole("button", { name: "Report sent", exact: true })).toBeDisabled();
	expect(report.context).toBe("application-crash");
	expect(report.logs).toContain("Test view crashed");
});

for (const engine of ["lightning", "native"]) {
	test(`${engine} failure keeps report in view above full scrollable export diagnostics`, async ({
		page,
	}) => {
		await page.setViewportSize({ width: 760, height: 480 });
		const reports: Record<string, unknown>[] = [];
		await page.route("**/functions/v1/submit-export-error", async (route) => {
			reports.push(route.request().postDataJSON());
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: '{"success":true}',
			});
		});
		let copied = "";
		await page.exposeFunction("captureErrorCopy", (text: string) => {
			copied = text;
		});
		await page.addInitScript(() => {
			Object.defineProperty(navigator, "clipboard", {
				configurable: true,
				value: {
					writeText: async (text: string) =>
						(
							window as unknown as { captureErrorCopy(text: string): Promise<void> }
						).captureErrorCopy(text),
				},
			});
		});
		await page.goto(`/tests/ui/export-error-report.html?menu&pending&engine=${engine}`);
		await page.getByRole("button", { name: "Fail export", exact: true }).click();
		const menu = page.getByRole("dialog", { name: "Publish", exact: true });
		const report = menu.getByRole("button", { name: "Report error", exact: true });
		await expect(report).toBeInViewport({ ratio: 1 });
		const copy = menu.getByRole("button", { name: "Copy error", exact: true });
		await expect(copy).toBeInViewport({ ratio: 1 });
		await expect(menu.getByRole("button", { name: "Save Again", exact: true })).toBeInViewport({
			ratio: 1,
		});
		const details = menu.locator("[data-export-error-details]");
		await expect(details).toContainText("Diagnostic tail: full failure retained");
		expect(await details.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
		expect(reports).toHaveLength(0);
		await copy.click();
		expect(copied).toBe(await details.textContent());
		expect(copied).toContain("Diagnostic tail: full failure retained");
		await report.click();
		await expect(menu.getByRole("button", { name: "Report sent", exact: true })).toBeDisabled();
		expect(reports).toHaveLength(1);
		expect(reports[0]).toMatchObject({ context: "export", format: "mp4" });
		expect(reports[0].error).toContain("Diagnostic tail: full failure retained");
		expect(JSON.stringify(reports[0])).not.toContain("Alice");
	});
	test(`${engine} export toast keeps reporting in a short viewport and retries a failed send`, async ({
		page,
	}) => {
		await page.setViewportSize({ width: 760, height: 480 });
		const reports: Record<string, unknown>[] = [];
		let releaseFirst: (() => void) | undefined;
		await page.route("**/functions/v1/submit-export-error", async (route) => {
			expect(route.request().headers().authorization).toBeUndefined();
			reports.push(route.request().postDataJSON());
			if (reports.length === 1)
				await new Promise<void>((resolve) => {
					releaseFirst = resolve;
				});
			await route.fulfill({
				status: reports.length === 1 ? 500 : 200,
				contentType: "application/json",
				body: reports.length === 1 ? "{}" : '{"success":true}',
			});
		});
		await page.goto(`/tests/ui/export-error-report.html?toast&engine=${engine}`);
		await page.getByRole("button", { name: "Fail export", exact: true }).click();
		const report = page.getByRole("button", { name: "Report error", exact: true });
		await expect(report).toBeInViewport({ ratio: 1 });
		const copy = page.getByRole("button", { name: "Copy", exact: true });
		await expect(copy).toBeInViewport({ ratio: 1 });
		const reportBox = (await report.boundingBox())!;
		const copyBox = (await copy.boundingBox())!;
		expect(Math.abs(reportBox.y - copyBox.y)).toBeLessThan(1);
		expect(reportBox.x + reportBox.width).toBeLessThan(copyBox.x);
		const details = page.locator("[data-error-diagnostics]");
		await expect(details).toContainText("Diagnostic tail: full failure retained");
		expect(await details.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
		expect(reports).toHaveLength(0);
		await report.dblclick();
		await expect(
			page.getByRole("button", { name: "Sending logs…", exact: true }),
		).toBeDisabled();
		await expect.poll(() => reports.length).toBe(1);
		releaseFirst?.();
		const retry = page.getByRole("button", { name: "Retry report", exact: true });
		await expect(retry).toBeInViewport({ ratio: 1 });
		const retryBox = (await retry.boundingBox())!;
		const retryCopyBox = (await copy.boundingBox())!;
		expect(Math.abs(retryBox.y - retryCopyBox.y)).toBeLessThan(1);
		expect(retryBox.x + retryBox.width).toBeLessThan(retryCopyBox.x);
		await retry.click();
		await expect(page.getByRole("button", { name: "Report sent", exact: true })).toBeDisabled();
		expect(reports).toHaveLength(2);
		expect(reports[1]).toMatchObject({ context: "notification" });
		expect(reports[1].error).toContain("Diagnostic tail: full failure retained");
		expect(JSON.stringify(reports[1])).not.toContain("alice@example.com");
	});
}

test("a multiline generic error title cannot push Report outside a short viewport", async ({
	page,
}) => {
	await page.setViewportSize({ width: 760, height: 480 });
	await page.goto("/tests/ui/export-error-report.html?toast&title");
	await page.getByRole("button", { name: "Fail export", exact: true }).click();
	await expect(page.getByRole("button", { name: "Report error", exact: true })).toBeInViewport({
		ratio: 1,
	});
	const title = page.locator("[data-error-title]");
	expect(await title.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
	await expect(title).toContainText("Diagnostic tail: full failure retained");
});
