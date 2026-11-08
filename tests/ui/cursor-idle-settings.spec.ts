import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("cursor idle hiding defaults on and advanced timings survive toggling the feature", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	await page.getByRole("radio", { name: "Cursor", exact: true }).click();
	const hide = page.getByRole("switch", { name: "Hide cursor when idle", exact: true });
	await expect(hide).toBeChecked();
	const detection = page.getByRole("slider", { name: "Idle detection", exact: true });
	const delay = page.getByRole("slider", { name: "Fade delay", exact: true });
	const fade = page.getByRole("slider", { name: "Fade duration", exact: true });
	const tolerance = page.getByRole("slider", { name: "Movement tolerance", exact: true });
	await expect(detection).toHaveCount(0);
	await page.locator("aside").getByText("Advanced", { exact: true }).click();
	await expect(detection).toHaveValue("2000");
	await expect(delay).toHaveValue("500");
	await expect(fade).toHaveValue("300");
	await expect(tolerance).toHaveValue("2");
	await detection.focus();
	await page.keyboard.press("ArrowRight");
	await expect(detection).toHaveValue("2100");
	await delay.focus();
	await page.keyboard.press("ArrowRight");
	await expect(delay).toHaveValue("550");
	await fade.focus();
	await page.keyboard.press("ArrowRight");
	await expect(delay).toHaveValue("550");
	await expect(fade).toHaveValue("325");
	await tolerance.focus();
	await page.keyboard.press("ArrowRight");
	await expect(tolerance).toHaveValue("2.5");
	await hide.press("Space");
	await expect(hide).not.toBeChecked();
	await expect(detection).toHaveCount(0);
	await hide.press("Space");
	await expect(detection).toHaveValue("2100");
	await expect(delay).toHaveValue("550");
	await expect(fade).toHaveValue("325");
	await expect(tolerance).toHaveValue("2.5");
});
