import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

for (const free of [false, true]) {
	for (const portrait of [false, true]) {
		test(`shared encoding is capped before probing (${free ? "free" : "Cloud"}, ${portrait ? "portrait" : "landscape"})`, async ({
			page,
		}) => {
			await page.goto(
				`/tests/ui/export-resolution-presets.html?limit=1920${free ? "&free" : ""}${portrait ? "&portrait" : ""}`,
			);
			await page.getByRole("row", { name: free ? /^QHD,/ : /^4K \(Cloud\),/ }).click();
			await page.getByRole("button", { name: "Export Video", exact: true }).click();
			await expect(page.getByTestId("export-result")).toContainText("cannot export");
			await page.getByRole("button", { name: "Prepare shared video" }).click();
			const long = free ? 1280 : 1920;
			const short = free ? 720 : 1080;
			await expect(page.getByTestId("export-result")).toHaveText(
				portrait ? `${short} × ${long}` : `${long} × ${short}`,
			);
		});
	}
}

test("upgrade modal explains shared video quality", async ({ page }, testInfo) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false });
	await page.goto("/tests/ui/billing-usage.html");
	await page.getByRole("button", { name: "Open test pricing", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Recordly Cloud" });
	await expect(
		dialog
			.getByRole("list", { name: "Your Cloud benefits" })
			.getByRole("listitem")
			.filter({ hasText: "Share videos in high-definition 1080p" }),
	).toBeVisible();
	await page.screenshot({ path: testInfo.outputPath("share-quality-upgrade.png") });
});
