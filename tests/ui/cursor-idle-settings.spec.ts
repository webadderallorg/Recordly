import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("cursor idle toggle stays available in basic and advanced settings without timing controls", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	await page.getByRole("radio", { name: "Cursor", exact: true }).click();
	const hide = page.getByRole("switch", { name: "Hide when idle", exact: true });
	await expect(hide).toBeChecked();
	await hide.press("Space");
	await expect(hide).not.toBeChecked();
	await page.getByRole("switch", { name: "Advanced settings", exact: true }).press("Space");
	await expect(hide).not.toBeChecked();
	for (const name of ["Idle detection", "Fade delay", "Fade duration", "Movement tolerance"])
		await expect(page.getByRole("slider", { name, exact: true })).toHaveCount(0);
	await hide.press("Space");
	await expect(hide).toBeChecked();
	await page.getByRole("switch", { name: "Advanced settings", exact: true }).press("Space");
	await expect(hide).toBeChecked();
});
