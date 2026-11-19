import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
	// Compare the open menu's final geometry, independent of its entrance animation.
	await page.emulateMedia({ reducedMotion: "reduce" });
});

async function chooseSort(page: Page, label: string, raw = false) {
	await page
		.getByRole("button", { name: raw ? "Sort raw files" : "Sort projects", exact: true })
		.click();
	await page.getByRole("menu").getByText(label, { exact: true }).click();
}

test("every project sort reverses direction with unknown metadata last and no repeated probes", async ({
	page,
}, testInfo) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/tests/ui/library-sort.html");
	const visible = page.getByRole("list", { name: "Visible projects" }).getByRole("listitem");
	const sort = page.getByRole("button", { name: "Sort projects", exact: true });
	const direction = page.locator("[data-sort-direction]");
	await expect(visible).toHaveText(["Short voice", "Long silent", "Medium audio", "Unavailable"]);
	await expect(direction).toHaveAccessibleName("Sort ascending");
	await expect(direction).toHaveAccessibleDescription("Newest first");
	await direction.click();
	await expect(direction).toHaveAccessibleName("Sort descending");
	await expect(visible).toHaveText(["Unavailable", "Medium audio", "Long silent", "Short voice"]);
	await chooseSort(page, "Last created");
	await expect(visible).toHaveText(["Medium audio", "Unavailable", "Long silent", "Short voice"]);
	await direction.click();
	await expect(visible).toHaveText(["Short voice", "Long silent", "Unavailable", "Medium audio"]);
	await chooseSort(page, "Name");
	await expect(direction).toHaveAttribute("data-sort-direction", "asc");
	await expect(visible).toHaveText(["Long silent", "Medium audio", "Short voice", "Unavailable"]);
	await direction.click();
	await expect(visible).toHaveText(["Unavailable", "Short voice", "Medium audio", "Long silent"]);
	await expect(page.locator("html")).toHaveAttribute("data-probes", "0");
	await chooseSort(page, "Duration");
	await expect(visible).toHaveText(["Long silent", "Medium audio", "Short voice", "Unavailable"]);
	await expect(direction).toHaveAccessibleDescription("Longest first");
	await expect(sort).toHaveText("Duration");
	await expect(page.locator("html")).toHaveAttribute("data-probes", "3");
	await expect(page.locator("html")).toHaveAttribute("data-max-concurrent-probes", "2");
	await sort.click();
	const menu = page.getByRole("menu", { name: "Sort projects", exact: true });
	const selected = menu.locator('[aria-checked="true"]');
	await expect(selected).toHaveText("Duration");
	const indicator = (await selected.locator('[data-slot="menu-item-indicator"]').boundingBox())!;
	const label = (await selected.getByText("Duration", { exact: true }).boundingBox())!;
	expect(label.x - indicator.x - indicator.width).toBeGreaterThanOrEqual(4);
	const menuBox = (await menu.boundingBox())!;
	expect(menuBox.width).toBeLessThanOrEqual(240);
	expect(menuBox.height).toBeLessThan(260);
	await page.screenshot({
		path: testInfo.outputPath("library-sort-direction.png"),
		animations: "disabled",
	});
	await page.keyboard.press("Escape");
	await direction.click();
	await expect(direction).toHaveAccessibleDescription("Shortest first");
	await expect(visible).toHaveText(["Short voice", "Medium audio", "Long silent", "Unavailable"]);
	await expect(page.locator("html")).toHaveAttribute("data-probes", "3");
	await chooseSort(page, "Audio");
	await expect(visible).toHaveText(["Short voice", "Medium audio", "Long silent", "Unavailable"]);
	await expect(direction).toHaveAccessibleDescription("Audio recordings first");
	await direction.click();
	await expect(visible).toHaveText(["Long silent", "Short voice", "Medium audio", "Unavailable"]);
	await expect(direction).toHaveAccessibleDescription("Silent recordings first");
	await expect(page.locator("html")).toHaveAttribute("data-probes", "6");
	await direction.click();
	await expect(page.locator("html")).toHaveAttribute("data-probes", "6");
	await page.getByRole("textbox", { name: "Search projects", exact: true }).fill("silent");
	await expect(visible).toHaveText(["Long silent"]);
	await sort.focus();
	await sort.press("ArrowDown");
	await expect(menu).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(menu).not.toBeVisible();
	await expect(sort).toBeFocused();
	await page.locator("main").evaluate((node) => {
		node.style.width = "360px";
	});
	const container = (await page.locator("main").boundingBox())!;
	for (const control of [sort, direction]) {
		const box = (await control.boundingBox())!;
		expect(box.x + box.width).toBeLessThanOrEqual(container.x + container.width);
		expect(box.x).toBeGreaterThanOrEqual(container.x);
	}
	expect(errors).toEqual([]);
});

test("raw audio/video duration and audio-presence sorts reverse without decoding again", async ({
	page,
}) => {
	await page.goto("/tests/ui/library-sort.html");
	await page.getByRole("button", { name: "Raw files", exact: true }).click();
	const visible = page.getByRole("list", { name: "Visible projects" }).getByRole("listitem");
	const direction = page.locator("[data-sort-direction]");
	await expect(visible).toHaveText(["Silent video", "Short voice", "Long voice"]);
	await direction.click();
	await expect(visible).toHaveText(["Long voice", "Short voice", "Silent video"]);
	await chooseSort(page, "Name", true);
	await expect(visible).toHaveText(["Long voice", "Short voice", "Silent video"]);
	await direction.click();
	await expect(visible).toHaveText(["Silent video", "Short voice", "Long voice"]);
	await chooseSort(page, "Duration", true);
	await expect(visible).toHaveText(["Silent video", "Long voice", "Short voice"]);
	await direction.click();
	await expect(visible).toHaveText(["Short voice", "Long voice", "Silent video"]);
	await expect(page.locator("html")).toHaveAttribute("data-probes", "1");
	await chooseSort(page, "Audio", true);
	await expect(visible).toHaveText(["Short voice", "Long voice", "Silent video"]);
	await direction.click();
	await expect(visible).toHaveText(["Silent video", "Short voice", "Long voice"]);
});

test("the production shared-links library reverses every supported criterion", async ({ page }) => {
	await page.goto("/tests/ui/library-sort.html?shared");
	const list = page.getByRole("list", { name: "Shared projects", exact: true });
	const names = () =>
		list
			.locator(":scope > li > button")
			.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")));
	const direction = page.locator("[data-sort-direction]");
	await expect.poll(names).toEqual(["Beta", "Gamma", "Alpha"]);
	await direction.click();
	await expect.poll(names).toEqual(["Alpha", "Gamma", "Beta"]);
	await chooseSort(page, "Last created");
	await expect.poll(names).toEqual(["Beta", "Gamma", "Alpha"]);
	await direction.click();
	await expect.poll(names).toEqual(["Alpha", "Gamma", "Beta"]);
	await chooseSort(page, "Name");
	await expect.poll(names).toEqual(["Alpha", "Beta", "Gamma"]);
	await direction.click();
	await expect.poll(names).toEqual(["Gamma", "Beta", "Alpha"]);
	await page.getByRole("button", { name: "Sort projects", exact: true }).click();
	const menu = page.getByRole("menu");
	await expect(menu.getByRole("menuitemradio")).toHaveCount(3);
	await expect(menu.getByText("Audio", { exact: true })).toHaveCount(0);
	await expect(page.locator("html")).toHaveAttribute("data-probes", "0");
});
