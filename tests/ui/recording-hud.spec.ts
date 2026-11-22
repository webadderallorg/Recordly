import { expect, test } from "@playwright/test";

test("compact recording pill has only stop, pause and discard, with no movement on pause", async ({
	page,
}) => {
	await page.goto("/tests/ui/recording-hud.html");
	const controls = page.getByRole("group", { name: "Recording controls", exact: true });
	await expect(controls).toBeVisible();
	await expect(controls.getByRole("button")).toHaveCount(3);
	await expect(controls.getByRole("timer")).toHaveText("1:05");
	const bounds = await controls.boundingBox();
	const pause = page.getByRole("button", { name: "Pause", exact: true });
	const pauseBounds = await pause.boundingBox();
	await pause.click();
	const resume = page.getByRole("button", { name: "Resume", exact: true });
	await expect(resume).toBeVisible();
	expect(await controls.boundingBox()).toEqual(bounds);
	expect(await resume.boundingBox()).toEqual(pauseBounds);
	await resume.click();
	await page
		.locator(".launch-theme")
		.screenshot({ path: "test-results/hud-recording-reference.png" });
	await page.getByRole("button", { name: "Discard recording", exact: true }).click();
	await expect(page.getByLabel("Last action")).toHaveText("discard");
	await expect(controls.getByRole("button", { name: /Hide/ })).toHaveCount(0);
	await page.getByRole("button", { name: "Stop", exact: true }).click();
	await expect(page.getByLabel("Last action")).toHaveText("stop");
});
