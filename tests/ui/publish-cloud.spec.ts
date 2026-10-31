import { expect, test } from "@playwright/test";

test("publish preserves local destination and stays open throughout sharing", async ({ page }) => {
	await page.goto("/tests/ui/publish.html?switch");
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await page.getByRole("row", { name: "Local", exact: true }).click();
	await expect(page.getByRole("button", { name: "Export Video", exact: true })).toBeVisible();
	await page.reload();
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await expect(page.getByRole("row", { name: "Local", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await page.getByRole("row", { name: "Link", exact: true }).click();
	await page.getByRole("button", { name: "Share", exact: true }).click();
	await expect(page.getByText(/Uploading ·/)).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByText(/Uploading ·/)).toBeVisible();
	await expect(page.getByRole("row", { name: "Local", exact: true })).toHaveAttribute(
		"aria-disabled",
		"true",
	);
	await expect(page.getByRole("button", { name: "Copy link", exact: true })).toBeVisible({
		timeout: 20000,
	});
	await page
		.getByRole("button", { name: "Fixture refresh token", exact: true })
		.evaluate((button: HTMLButtonElement) => button.click());
	await expect(page.getByRole("button", { name: "Copy link", exact: true })).toBeVisible();
	await page
		.getByRole("button", { name: "Fixture switch account", exact: true })
		.evaluate((button: HTMLButtonElement) => button.click());
	await expect(page.getByRole("button", { name: "Copy link", exact: true })).toHaveCount(0);
});

test("a full cloud quota prevents starting preparation", async ({ page }) => {
	await page.goto("/tests/ui/publish.html?full");
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await expect(
		page.getByText(
			"You have 5 cloud recordings. Delete one from Shared before sharing another.",
		),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Share", exact: true })).toBeDisabled();
});

test("shared cards open ready links and delete incomplete uploads", async ({ page }) => {
	await page.goto("/tests/ui/shared-recordings.html");
	await page.getByRole("button", { name: "Product walkthrough", exact: true }).click();
	await expect(page.getByRole("status")).toHaveText("Opened https://example.test/s/demo1");
	await expect(
		page.getByRole("button", { name: "An interrupted upload", exact: true }),
	).toBeDisabled();
	await page
		.getByRole("button", { name: "Options for An interrupted upload", exact: true })
		.click();
	page.once("dialog", (dialog) => dialog.dismiss());
	await page.getByRole("menuitem", { name: "Delete recording", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "An interrupted upload", exact: true }),
	).toHaveCount(1);
	await page
		.getByRole("button", { name: "Options for An interrupted upload", exact: true })
		.click();
	page.once("dialog", (dialog) => dialog.accept());
	await page.getByRole("menuitem", { name: "Delete recording", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "An interrupted upload", exact: true }),
	).toHaveCount(0);
	await page.getByRole("textbox", { name: "Search projects" }).fill("missing");
	await expect(page.getByText("No matching projects", { exact: true })).toBeVisible();
});

test("switching accounts clears the previous account's cloud quota", async ({ page }) => {
	await page.goto("/tests/ui/publish.html?full&switch");
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await expect(
		page.getByText(
			"You have 5 cloud recordings. Delete one from Shared before sharing another.",
		),
	).toBeVisible();
	await page
		.getByRole("button", { name: "Fixture sign out", exact: true })
		.evaluate((button: HTMLButtonElement) => button.click());
	await expect(
		page.getByText(
			"You have 5 cloud recordings. Delete one from Shared before sharing another.",
		),
	).toHaveCount(0);
	await page
		.getByRole("button", { name: "Fixture switch account", exact: true })
		.evaluate((button: HTMLButtonElement) => button.click());
	await expect(page.getByRole("button", { name: "Share", exact: true })).toBeEnabled();
});

for (const fails of [false, true]) {
	test(`ignores an old account's late upload ${fails ? "error" : "success"}`, async ({
		page,
	}) => {
		await page.goto(`/tests/ui/publish.html?switch&controlled${fails ? "&fail" : ""}`);
		await page.getByRole("button", { name: "Publish", exact: true }).click();
		await page.getByRole("button", { name: "Share", exact: true }).click();
		await expect(page.getByText("Uploading · 85%", { exact: true })).toBeVisible();
		await page
			.getByRole("button", { name: "Fixture switch account", exact: true })
			.evaluate((button: HTMLButtonElement) => button.click());
		await page
			.getByRole("button", { name: "Fixture finish upload", exact: true })
			.evaluate((button: HTMLButtonElement) => button.click());
		await expect(page.getByRole("button", { name: "Share", exact: true })).toBeEnabled();
		await expect(page.getByRole("button", { name: "Copy link", exact: true })).toHaveCount(0);
		await expect(
			page.getByText("Fixture old-account upload failed", { exact: true }),
		).toHaveCount(0);
	});
}

test("deleting from another shared library refreshes a mounted Share quota", async ({ page }) => {
	await page.goto("/tests/ui/shared-recordings.html?capacity");
	await expect(page.getByRole("button", { name: "Share", exact: true })).toBeDisabled();
	await page
		.getByRole("button", { name: "Options for An interrupted upload", exact: true })
		.click();
	page.once("dialog", (dialog) => dialog.dismiss());
	await page.getByRole("menuitem", { name: "Delete recording", exact: true }).click();
	await expect(page.getByRole("button", { name: "Share", exact: true })).toBeDisabled();
	await page
		.getByRole("button", { name: "Options for An interrupted upload", exact: true })
		.click();
	page.once("dialog", (dialog) => dialog.accept());
	await page.getByRole("menuitem", { name: "Delete recording", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "An interrupted upload", exact: true }),
	).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Share", exact: true })).toBeEnabled();
	await expect(
		page.getByText(
			"You have 5 cloud recordings. Delete one from Shared before sharing another.",
		),
	).toHaveCount(0);
});

for (const destination of ["Local", "Link"]) {
	test(`Publish preserves manual export reporting for ${destination}`, async ({ page }) => {
		await page.goto("/tests/ui/publish.html?export-error");
		await page.getByRole("button", { name: "Publish", exact: true }).click();
		await page.getByRole("row", { name: destination, exact: true }).click();
		await page.getByRole("button", { name: "Report error", exact: true }).click();
		const dialog = page.getByRole("dialog", { name: "Report export error", exact: true });
		await expect(dialog).toBeVisible();
		await dialog.getByText("View data to be sent", { exact: true }).click();
		await expect(dialog.locator("pre")).toContainText("VIDEO_DECODE_ENCODING_ERROR");
	});
}
