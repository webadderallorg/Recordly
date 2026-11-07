import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

for (const clearSelection of [false, true]) {
	test(`feedback submits without an emoji${clearSelection ? " after clearing a selection" : ""}`, async ({
		page,
	}) => {
		await installDesktopBridge(page);
		let requestBody = "";
		await page.route("**/functions/v1/submit-feedback", async (route) => {
			requestBody = route.request().postData() ?? "";
			await route.fulfill({ json: { success: true } });
		});
		await page.goto("/?windowType=editor");
		await page.getByRole("button", { name: "Recordly account", exact: true }).click();
		await page
			.getByRole("dialog", { name: "Account menu", exact: true })
			.getByRole("button", { name: "Feedback", exact: true })
			.click();
		const modal = page.getByRole("dialog", { name: "Send feedback", exact: true });
		if (clearSelection) {
			const loving = modal.getByRole("button", { name: "Loving", exact: true });
			await loving.click();
			await expect(loving).toHaveAttribute("aria-pressed", "true");
			await loving.click();
		}
		await expect(modal.locator('[aria-pressed="true"]')).toHaveCount(0);
		await modal.getByRole("button", { name: "Send feedback", exact: true }).click();
		await expect(modal).toBeVisible();
		expect(requestBody).toBe("");
		await modal
			.getByLabel("Description", { exact: true })
			.fill("Please add more keyboard shortcuts.");
		await modal.getByRole("button", { name: "Send feedback", exact: true }).click();
		await expect(
			page.getByRole("dialog", { name: "Thanks for your feedback", exact: true }),
		).toBeVisible();
		expect(requestBody).toContain('name="title"\r\n\r\nPlease add more keyboard shortcuts.');
		expect(requestBody).not.toMatch(/🥰|😐|😠/u);
	});
}

for (const signedIn of [false, true]) {
	test(`feedback offers Contact without duplicate email when signed ${signedIn ? "in" : "out"}`, async ({
		page,
	}) => {
		await installDesktopBridge(page, undefined, { signedIn });
		await page.addInitScript(() => {
			window.electronAPI.openExternalUrl = async (url: string) => {
				document.documentElement.dataset.openedExternalUrl = url;
				return { success: true };
			};
		});
		await page.goto("/?windowType=editor");
		if (signedIn) {
			await page.getByRole("button", { name: "Recordly account", exact: true }).click();
			await page
				.getByRole("dialog", { name: "Account menu", exact: true })
				.getByRole("button", { name: "Feedback", exact: true })
				.click();
		} else {
			await page.getByRole("button", { name: "Feedback", exact: true }).click();
		}
		const modal = page.getByRole("dialog", { name: "Send feedback", exact: true });
		await expect(
			modal.getByRole("link", { name: "support@recordly.dev", exact: true }),
		).toHaveCount(0);
		await modal.getByRole("button", { name: "Contact", exact: true }).click();
		const contact = page.getByRole("dialog", { name: "Contact", exact: true });
		const email = contact.getByRole("button", { name: "support@recordly.dev", exact: true });
		await email.click();
		await expect(page.locator("html")).toHaveAttribute(
			"data-opened-external-url",
			"mailto:support@recordly.dev",
		);
		await page.keyboard.press("Escape");
		await expect(modal).toBeVisible();
	});
}

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
	await expect(
		modal.getByText(
			"Diagnostic logs will be attached. Feedback will be sent to support@recordly.dev.",
		),
	).toBeVisible();
	await expect(modal.getByRole("checkbox")).toHaveCount(0);
	await expect(modal.getByLabel("Title", { exact: true })).toHaveCount(0);
	await modal.getByRole("button", { name: "Send feedback", exact: true }).click();
	await expect(modal.getByRole("alert")).toHaveText(
		"Could not send feedback. Please try again. Report Error",
	);
	const report = modal
		.getByRole("alert")
		.getByRole("button", { name: "Report Error", exact: true });
	await expect(report).toBeVisible();
	// Keyboard focus remains visible despite the global outline reset.
	await page.keyboard.press("Tab");
	await report.focus();
	await expect.poll(() => report.evaluate((node) => node.matches(":focus-visible"))).toBe(true);
	await expect(report).not.toHaveCSS("box-shadow", "none");
	// Pointer focus still suppresses the ring, including shortcut-induced :focus-visible.
	await report.dispatchEvent("pointerdown", { button: 0, pointerId: 1 });
	await expect(report).toHaveAttribute("data-pointer-focus", "");
	await expect
		.poll(() =>
			report.evaluate((node) =>
				getComputedStyle(node).getPropertyValue("--tw-ring-color").trim(),
			),
		)
		.toBe("transparent");
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
