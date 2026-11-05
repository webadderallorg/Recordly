import { expect, test } from "@playwright/test";

for (const mode of ["modern", "legacy", "gif"]) {
	test(`${mode} export shows progress and rotating tips without implementation details`, async ({
		page,
	}) => {
		await page.clock.install();
		await page.goto(`/tests/ui/export-progress.html?${mode}`);
		const dialog = page.getByRole("dialog", { name: "Publish", exact: true });
		await expect(dialog.getByRole("progressbar", { name: "Exporting" })).toHaveAttribute(
			"aria-valuenow",
			"42",
		);
		await expect(dialog.getByText("42% complete", { exact: true })).toBeVisible();
		if (mode !== "link") {
			await expect(dialog.locator(".export-animation")).toHaveCount(0);
		}
		await expect(
			dialog.getByText("Tip: Turn off auto-applied zooms in settings", { exact: true }),
		).toBeVisible();
		await expect(dialog.getByRole("grid", { name: "Publish destination" })).toHaveCount(0);
		await expect(dialog).not.toContainText(
			/Breeze|Path:|WebGPU|Native skipped|Render speed|Processing audio|Lightning export|Promotional announcement|Extra announcement content/,
		);
		await page.clock.fastForward(6100);
		await expect(
			dialog.getByText("Tip: Try experimental builds by turning on access in settings", {
				exact: true,
			}),
		).toBeVisible();
		await expect(dialog).not.toContainText(
			/Promotional announcement|Extra announcement content/,
		);
		if (mode === "modern") await page.screenshot({ path: "test-results/export-progress.png" });
		await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
		await expect(page.locator("html")).toHaveAttribute("data-cancelled", "true");
	});
}

for (const phase of ["preparing", "finalizing", "saving", "audio"]) {
	test(`${phase} export remains free of technical details`, async ({ page }) => {
		await page.goto(`/tests/ui/export-progress.html?modern&${phase}`);
		const dialog = page.getByRole("dialog", { name: "Publish", exact: true });
		await expect(dialog.getByRole("progressbar", { name: "Exporting" })).toBeVisible();
		await expect(
			dialog.getByText("Tip: Turn off auto-applied zooms in settings", { exact: true }),
		).toBeVisible();
		await expect(dialog).not.toContainText(
			/Breeze|Path:|WebGPU|Native skipped|Render speed|Muxing|Rendering audio|Processing audio/,
		);
	});
}

for (const [phase, label] of [
	["finalizing", "Finishing GIF…"],
	["optimizing", "Optimizing GIF…"],
	["saving", "Saving GIF…"],
]) {
	test(`GIF ${phase} shows activity without claiming completion`, async ({ page }) => {
		await page.goto(`/tests/ui/export-progress.html?gif&${phase}&complete-frames`);
		const dialog = page.getByRole("dialog", { name: "Publish", exact: true });
		await expect(dialog.getByText(label, { exact: true })).toBeVisible();
		await expect(dialog.getByRole("progressbar", { name: "Exporting" })).not.toHaveAttribute(
			"aria-valuenow",
		);
		await expect(dialog).not.toContainText(/100%|0s|0 seconds/);
		await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeEnabled();
	});
}

test("GIF frame progress cannot round up to completion before the file is saved", async ({
	page,
}) => {
	await page.goto("/tests/ui/export-progress.html?gif&complete-frames");
	const dialog = page.getByRole("dialog", { name: "Publish", exact: true });
	await expect(dialog.getByRole("progressbar", { name: "Exporting" })).toHaveAttribute(
		"aria-valuenow",
		"95",
	);
	await expect(dialog.getByText("95% complete", { exact: true })).toBeVisible();
	await expect(dialog).not.toContainText("100%");
});

test("GIF completion is shown after the file has been saved", async ({ page }) => {
	await page.goto("/tests/ui/export-progress.html?gif&saved");
	const dialog = page.getByRole("dialog", { name: "Publish", exact: true });
	await expect(dialog.getByText("Export complete", { exact: true })).toBeVisible();
	await expect(
		dialog.getByText("Your file was saved successfully.", { exact: true }),
	).toBeVisible();
	await expect(dialog.getByText("export.gif", { exact: true })).toBeVisible();
	await expect(dialog.getByRole("progressbar")).toHaveCount(0);
	await expect(dialog.locator(".export-animation")).toHaveCount(0);
});

test("link preparation shows overall share progress and remains cancellable", async ({ page }) => {
	await page.goto("/tests/ui/export-progress.html?link");
	const dialog = page.getByRole("dialog", { name: "Publish", exact: true });
	await dialog.getByRole("button", { name: "Share", exact: true }).click();
	// Rendering occupies 70% of the complete share flow; 42% rendered means 29% overall.
	await expect(
		dialog.getByRole("progressbar", { name: "Create link", exact: true }),
	).toHaveAttribute("aria-valuenow", "29");
	await expect(dialog.getByText("29% complete", { exact: true })).toBeVisible();
	await expect(
		dialog.getByRole("row", { name: "Create share link", exact: true }),
	).toHaveAttribute("aria-disabled", "true");
	await expect(dialog.getByRole("row", { name: "Save video", exact: true })).toHaveAttribute(
		"aria-disabled",
		"true",
	);
	await expect(dialog).not.toContainText(
		/Breeze|Path:|WebGPU|Native skipped|Render speed|Processing audio/,
	);
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-cancelled", "true");
	await expect(dialog.getByRole("progressbar")).toHaveCount(0);
});

test("signed-out link preparation requires sign-in before showing progress", async ({ page }) => {
	await page.goto("/tests/ui/export-progress.html?link&signed-out");
	const dialog = page.getByRole("dialog", { name: "Publish", exact: true });
	await expect(
		dialog.getByRole("button", { name: "Sign in to share", exact: true }),
	).toBeVisible();
	await expect(dialog.getByRole("progressbar")).toHaveCount(0);
});
