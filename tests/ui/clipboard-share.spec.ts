import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

for (const title of ["My walkthrough", "", "   "]) {
	test(`shares with empty notes and ${title.trim() ? "an edited" : JSON.stringify(title)} title`, async ({
		page,
	}) => {
		await page.goto("/tests/ui/clipboard-share.html");
		await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Fixture");
		await page.getByLabel("Title", { exact: true }).fill(title);
		await expect(page.getByLabel("Notes", { exact: true })).toHaveValue("");
		await expect(page.getByRole("button", { name: "Share", exact: true })).toBeEnabled();
		await page.getByRole("button", { name: "Share", exact: true }).click();
		await expect(page.getByLabel("Share link", { exact: true })).toHaveValue(
			"https://example.test/s/preview",
		);
		await expect(page.locator("html")).toHaveAttribute(
			"data-upload-metadata",
			JSON.stringify({ title: title.trim() || "Fixture", notes: null }),
		);
	});
}

test("copies a share link through the desktop bridge when the browser denies access", async ({
	page,
}) => {
	await page.goto("/tests/ui/clipboard-share.html");
	await expect(page.getByText(/Free cloud recordings expire/)).toHaveCount(0);
	await page.getByRole("button", { name: "Share", exact: true }).click();
	await expect(page.getByLabel("Share link", { exact: true })).toHaveValue(
		"https://example.test/s/preview",
	);
	await page.getByRole("button", { name: "Copy link", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute(
		"data-copied-text",
		"https://example.test/s/preview",
	);
	await expect(page.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
	await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
});

test("selects the actual link for manual copying without a recursive Copy error action", async ({
	page,
}) => {
	await page.goto("/tests/ui/clipboard-share.html?fail");
	await page.getByRole("button", { name: "Share", exact: true }).click();
	await page.getByRole("button", { name: "Copy link", exact: true }).click();
	const link = page.getByLabel("Share link", { exact: true });
	await expect(link).toBeFocused();
	expect(
		await link.evaluate(
			(input: HTMLInputElement) => input.selectionEnd! - input.selectionStart!,
		),
	).toBe("https://example.test/s/preview".length);
	await expect(
		page.getByText("Could not copy link. Select and copy it manually.", { exact: true }),
	).toHaveCount(1);
	await expect(page.getByRole("button", { name: "Copy", exact: true })).toHaveCount(0);
});

test("localizes the sharing and clipboard flow", async ({ page }) => {
	await page.addInitScript(() => localStorage.setItem("recordly.locale", "es"));
	await page.goto("/tests/ui/clipboard-share.html");
	await page.getByRole("button", { name: "Compartir", exact: true }).click();
	await page.getByRole("button", { name: "Copiar enlace", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute(
		"data-copied-text",
		"https://example.test/s/preview",
	);
	await expect(page.getByRole("button", { name: "Copy link", exact: true })).toHaveCount(0);
});

test("rejected free-account sessions offer sign-in instead of a plan refresh", async ({ page }) => {
	await page.goto("/tests/ui/clipboard-share.html?session-rejected");
	await expect(
		page.getByText("Your cloud session could not be verified. Sign in again to share."),
	).toBeVisible();
	await expect(page.getByText("Refresh plan", { exact: true })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Share", exact: true })).toBeDisabled();
	await page.getByRole("button", { name: "Check sign-in", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-sign-in-requested", "true");
});

for (const rejected of [false, true]) {
	test(`automatically refreshes a rejected session once (${rejected ? "still rejected" : "recovered"})`, async ({
		page,
	}) => {
		await installDesktopBridge(page);
		let refreshes = 0;
		page.on("request", (request) => {
			if (new URL(request.url()).pathname === "/auth/v1/token") refreshes++;
		});
		await page.goto(
			`/tests/ui/clipboard-share.html?recover-session${rejected ? "&session-rejected" : ""}`,
		);
		if (rejected) {
			await expect(
				page.getByRole("button", { name: "Check sign-in", exact: true }),
			).toBeVisible();
			await expect(page.getByRole("button", { name: "Share", exact: true })).toBeDisabled();
			await page.evaluate(() => window.dispatchEvent(new Event("focus")));
			await expect(
				page.getByRole("button", { name: "Check sign-in", exact: true }),
			).toBeVisible();
		} else {
			await expect(page.getByRole("button", { name: "Share", exact: true })).toBeEnabled();
			await page.getByRole("button", { name: "Share", exact: true }).click();
			await expect(page.getByLabel("Share link", { exact: true })).toHaveValue(
				"https://example.test/s/preview",
			);
		}
		expect(refreshes).toBe(1);
	});
}
