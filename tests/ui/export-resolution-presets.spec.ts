import { expect, test } from "@playwright/test";

test("Advanced shares the Resolution heading row above its presets", async ({ page }) => {
	await page.goto("/tests/ui/export-resolution-presets.html");
	const heading = await page.getByText("Resolution", { exact: true }).boundingBox();
	const advanced = await page.getByText("Advanced", { exact: true }).boundingBox();
	const presets = await page.getByRole("grid", { name: "Resolution", exact: true }).boundingBox();
	expect(
		Math.abs(heading!.y + heading!.height / 2 - advanced!.y - advanced!.height / 2),
	).toBeLessThan(3);
	expect(advanced!.y + advanced!.height).toBeLessThanOrEqual(presets!.y);
});

for (const portrait of [false, true]) {
	test(`resolution presets display and request exact ${portrait ? "portrait" : "landscape"} dimensions`, async ({
		page,
	}) => {
		await page.goto(`/tests/ui/export-resolution-presets.html${portrait ? "?portrait" : ""}`);
		for (const [label, landscape] of [
			["HD", "1280 × 720"],
			["FHD", "1920 × 1080"],
			["QHD", "2560 × 1440"],
			["4K", "3840 × 2160"],
		]) {
			const expected = portrait ? landscape.split(" × ").reverse().join(" × ") : landscape;
			const choice = page.getByRole("row", { name: `${label}, ${expected}`, exact: true });
			await expect(choice).toContainText(expected);
			await choice.click();
			await page.getByRole("button", { name: "Export Video", exact: true }).click();
			await expect(page.getByTestId("export-result")).toHaveText(expected);
		}
		await page.getByText("Advanced", { exact: true }).click();
		await page.getByRole("row", { name: /^Original/ }).click();
		await page.getByRole("button", { name: "Export Video", exact: true }).click();
		await expect(page.getByTestId("export-result")).toHaveText(
			portrait ? "720 × 1280" : "1280 × 720",
		);
		if (!portrait)
			await page.screenshot({ path: "test-results/export-resolution-presets.png" });
	});
}

test("an unsupported fixed preset reports an error instead of silently exporting smaller", async ({
	page,
}) => {
	await page.goto("/tests/ui/export-resolution-presets.html?limit=1920");
	await page.getByRole("row", { name: "4K, 3840 × 2160", exact: true }).click();
	await page.getByRole("button", { name: "Export Video", exact: true }).click();
	await expect(page.getByTestId("export-result")).toContainText(
		"cannot export 3840 × 2160 at 60 FPS",
	);
	await page.getByRole("row", { name: "FHD, 1920 × 1080", exact: true }).click();
	await page.getByRole("button", { name: "Export Video", exact: true }).click();
	await expect(page.getByTestId("export-result")).toHaveText("1920 × 1080");
});

test("4K and QHD exports are available without a Cloud subscription", async ({ page }) => {
	await page.goto("/tests/ui/export-resolution-presets.html?free");
	await expect(
		page.getByText("Commercial use requires an active Recordly Cloud subscription.", {
			exact: true,
		}),
	).toHaveCount(0);
	const personalUse = page.getByRole("checkbox", {
		name: "I’ll use this for personal use.",
		exact: true,
	});
	await expect(personalUse).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Upgrade to Cloud", exact: true })).toBeVisible();
	await expect(page.getByText("Upgrade to Cloud for commercial use", { exact: true })).toBeVisible();
	await page.screenshot({ path: test.info().outputPath("personal-use-export.png"), animations: "disabled" });
	await expect(page.getByRole("row", { name: /^Original/ })).toHaveCount(0);
	await expect(page.getByRole("grid", { name: "Encoding", exact: true })).toHaveCount(0);
	await page.getByRole("row", { name: "4K, 3840 × 2160", exact: true }).click();
	await page.getByRole("button", { name: "Export Video", exact: true }).click();
	await expect(page.getByTestId("export-result")).toHaveText("3840 × 2160");
	await page.getByRole("row", { name: "QHD, 2560 × 1440", exact: true }).click();
	await page.getByRole("button", { name: "Export Video", exact: true }).click();
	await expect(page.getByTestId("export-result")).toHaveText("2560 × 1440");
});

test("custom sizes stay linked, validate even dimensions, and reset to FHD when Advanced closes", async ({
	page,
}) => {
	await page.goto("/tests/ui/export-resolution-presets.html");
	await page.getByText("Advanced", { exact: true }).click();
	await page.getByRole("row", { name: "Custom", exact: true }).click();
	await page.getByRole("spinbutton", { name: "Width (px)" }).fill("2400");
	await expect(page.getByRole("spinbutton", { name: "Height (px)" })).toHaveValue("1350");
	await page.getByRole("button", { name: "Export Video", exact: true }).click();
	await expect(page.getByTestId("export-result")).toHaveText("2400 × 1350");
	await page.getByRole("spinbutton", { name: "Width (px)" }).fill("2401");
	await expect(page.getByRole("alert")).toContainText("even dimensions");
	await expect(page.getByRole("button", { name: "Export Video", exact: true })).toBeDisabled();
	await page.getByRole("spinbutton", { name: "Width (px)" }).fill("3840");
	await page.screenshot({ path: "test-results/export-resolution-advanced.png" });
	await page.getByText("Advanced", { exact: true }).click();
	await expect(page.getByRole("spinbutton", { name: "Width (px)" })).toHaveCount(0);
	await page.getByRole("button", { name: "Export Video", exact: true }).click();
	await expect(page.getByTestId("export-result")).toHaveText("1920 × 1080");
});

test("custom exports above QHD are available without a Cloud subscription", async ({ page }) => {
	await page.goto("/tests/ui/export-resolution-presets.html?free");
	await page.getByText("Advanced", { exact: true }).click();
	await page.getByRole("row", { name: "Custom", exact: true }).click();
	await page.getByRole("spinbutton", { name: "Width (px)" }).fill("3840");
	await page.getByRole("button", { name: "Export Video", exact: true }).click();
	await expect(page.getByTestId("export-result")).toHaveText("3840 × 2160");
});

test("encoding choices stay under Advanced and keep their selected mode for download and sharing", async ({
	page,
}) => {
	await page.goto("/tests/ui/export-resolution-presets.html");
	await expect(page.getByRole("grid", { name: "Resolution", exact: true })).toBeVisible();
	await expect(page.getByRole("row", { name: "Balanced", exact: true })).toHaveCount(0);
	await expect(page.getByRole("grid", { name: "Encoding", exact: true })).toHaveCount(0);
	await page.getByRole("button", { name: "Export Video", exact: true }).click();
	await expect(page.getByTestId("export-settings-result")).toContainText(
		'"encodingMode":"balanced"',
	);
	await page.getByText("Advanced", { exact: true }).click();
	const encoding = page.getByRole("grid", { name: "Encoding", exact: true });
	await expect(encoding.getByRole("row", { name: "Balanced", exact: true })).toHaveAttribute(
		"data-selected",
		"true",
	);
	await encoding.getByRole("row", { name: "Quality", exact: true }).click();
	await page.getByText("Advanced", { exact: true }).click();
	await expect(encoding).toHaveCount(0);
	await expect(page.getByRole("grid", { name: "Resolution", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Export Video", exact: true }).click();
	await expect(page.getByTestId("export-settings-result")).toContainText(
		'"encodingMode":"quality"',
	);
	await expect(page.getByTestId("export-settings-result")).toContainText(
		'"destination":"download"',
	);
	await page.getByRole("button", { name: "Prepare shared video", exact: true }).click();
	await expect(page.getByTestId("export-settings-result")).toContainText(
		'"encodingMode":"quality"',
	);
	await expect(page.getByTestId("export-settings-result")).toContainText('"destination":"share"');
	await page.reload();
	await expect(page.getByRole("grid", { name: "Encoding", exact: true })).toHaveCount(0);
	await page.getByText("Advanced", { exact: true }).click();
	await expect(page.getByRole("row", { name: "Quality", exact: true })).toHaveAttribute(
		"data-selected",
		"true",
	);
});
