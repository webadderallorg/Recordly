import { expect, type Locator, type Page, test } from "@playwright/test";

async function open(page: Page) {
	await page.goto("/tests/ui/hud-tooltips.html");
	const controls = page.getByRole("group", { name: "Recording setup", exact: true });
	await expect(controls).toBeVisible();
	return controls;
}

// React Aria only treats hover as pointer input once the pointer has moved, as a real cursor does.
async function hover(page: Page, target: Locator) {
	await page.mouse.move(0, 0);
	await page.mouse.move(1, 1);
	await target.hover();
}

test("every idle HUD control shows a tooltip on hover", async ({ page }) => {
	const controls = await open(page);
	await expect(controls.locator("[title]")).toHaveCount(0);
	for (const [name, label] of [
		["Record", "Start recording"],
		["Audio settings", "Audio settings: Microphone"],
		["Camera settings", "Camera settings: Off"],
		["Countdown delay", "Countdown delay: No delay"],
		["Home", "Home"],
		["Hide HUD", "Hide HUD"],
	]) {
		await hover(page, controls.getByRole("button", { name, exact: true }));
		await expect(page.getByRole("tooltip", { name: label, exact: true })).toBeVisible();
	}
	await page.mouse.move(0, 0);
	await expect(page.getByRole("tooltip")).toHaveCount(0);
});

test("tooltips open on keyboard focus and close on Escape", async ({ page }) => {
	const controls = await open(page);
	const audio = controls.getByRole("button", { name: "Audio settings", exact: true });
	for (let i = 0; i < 5 && !(await audio.evaluate((el) => el === document.activeElement)); i++) {
		await page.keyboard.press("Tab");
	}
	await expect(audio).toBeFocused();
	await expect(
		page.getByRole("tooltip", { name: "Audio settings: Microphone", exact: true }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("tooltip")).toHaveCount(0);
});

test("one Escape cancels a countdown while its tooltip is open", async ({ page }) => {
	const controls = await open(page);
	await controls.getByRole("button", { name: "Countdown delay", exact: true }).click();
	await page.getByRole("dialog").getByText("3 sec", { exact: true }).click();
	await controls.getByRole("button", { name: "Record", exact: true }).click();
	await hover(page, controls.getByRole("button", { name: "Cancel countdown", exact: true }));
	await expect(
		page.getByRole("tooltip", { name: "Cancel countdown", exact: true }),
	).toBeVisible();

	await page.keyboard.press("Escape");
	await expect(page.getByLabel("Last action")).toHaveText("cancel", { timeout: 1500 });
	await expect(controls.getByRole("button", { name: "Record", exact: true })).toBeVisible();
});

test("popover triggers hide their tooltip while open and show the new state after", async ({
	page,
}) => {
	const controls = await open(page);
	const countdown = controls.getByRole("button", { name: "Countdown delay", exact: true });
	await hover(page, countdown);
	await expect(page.getByRole("tooltip")).toBeVisible();
	await countdown.click();
	await expect(page.getByRole("dialog", { name: "Countdown delay" })).toBeVisible();
	await expect(page.getByRole("tooltip")).toHaveCount(0);
	await page.getByRole("dialog").getByText("3 sec", { exact: true }).click();
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await hover(page, countdown);
	await expect(
		page.getByRole("tooltip", { name: "Countdown delay: 3 sec", exact: true }),
	).toBeVisible();
});

test("the compact HUD keeps all countdown options reachable by scrolling", async ({ page }) => {
	await page.setViewportSize({ width: 860, height: 160 });
	const controls = await open(page);
	const timer = controls.getByRole("button", { name: "Countdown delay", exact: true });
	await timer.click();
	const options = page.getByRole("dialog", { name: "Countdown delay", exact: true });
	await expect(options).toBeInViewport({ ratio: 1 });
	expect(await options.evaluate((menu) => menu.scrollHeight)).toBeGreaterThan(
		await options.evaluate((menu) => menu.clientHeight),
	);
	await options.getByText("10 sec", { exact: true }).click();
	await expect(options).toHaveCount(0);
	await hover(page, timer);
	await expect(page.getByRole("tooltip", { name: "Countdown delay: 10 sec" })).toBeVisible();
});

test("a visible tooltip does not block clicks outside the HUD", async ({ page }) => {
	const controls = await open(page);
	await hover(page, controls.getByRole("button", { name: "Home", exact: true }));
	const tooltip = page.getByRole("tooltip", { name: "Home", exact: true });
	await expect(tooltip).toBeVisible();
	const box = await tooltip.boundingBox();
	if (!box) throw new Error("tooltip has no bounding box");
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	await expect(page.getByLabel("Last action")).toHaveText("behind");
});
