import { expect, test, type Page } from "@playwright/test";

async function option(page: Page, field: string, text: string) {
	const trigger = page.getByRole("button", { name: new RegExp(field) });
	await trigger.click();
	if (field === "Find") {
		await page
			.getByRole("menuitemcheckbox", { name: text, exact: true })
			.or(page.getByRole("menuitem", { name: text, exact: true }))
			.click();
		if ((await trigger.getAttribute("aria-expanded")) === "true")
			await page.keyboard.press("Escape");
	} else await page.getByRole("option", { name: text, exact: true }).click();
}
const cleanup = (page: Page) => page.getByRole("dialog", { name: "Clean up library", exact: true });
test("cleanup previews timelines, dates and duplicate keepers before selecting, then clears hidden selections", async ({
	page,
}, testInfo) => {
	await page.goto("/tests/ui/library-cleanup.html");
	const action = page.getByRole("button", { name: "Clean up", exact: true });
	await expect(action).toHaveClass(/button--ghost/);
	await expect(action.locator("svg")).toHaveCount(1);
	await action.click();
	const dialog = cleanup(page);
	const matches = dialog.getByRole("list", { name: "Cleanup matches" });
	await expect(matches.getByRole("checkbox")).toHaveCount(2);
	await expect(dialog.getByRole("button", { name: /Find/ })).toContainText("Unedited");
	await expect(dialog).not.toContainText("Search, folder and time filters");
	await expect(dialog).not.toContainText("Full-length timelines");
	await expect(matches.locator("img")).toHaveCount(2);
	await expect
		.poll(() =>
			matches
				.locator("img")
				.evaluateAll((images) =>
					images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
				),
		)
		.toBe(true);
	const thumbnailBounds = (await matches.locator("img").first().boundingBox())!;
	await page.mouse.click(
		thumbnailBounds.x + thumbnailBounds.width / 2,
		thumbnailBounds.y + thumbnailBounds.height / 2,
	);
	await expect(matches.getByRole("checkbox").first()).not.toBeChecked();
	await page.mouse.click(
		thumbnailBounds.x + thumbnailBounds.width / 2,
		thumbnailBounds.y + thumbnailBounds.height / 2,
	);
	await expect(matches.getByRole("checkbox").first()).toBeChecked();
	await expect(matches).not.toContainText("Trimmed edit");
	await expect(matches).not.toContainText("Open project");
	await option(page, "Age", "Any time");
	await expect(matches.getByRole("checkbox")).toHaveCount(3);
	await option(page, "Find", "Duplicates of original");
	await expect(matches.getByRole("checkbox")).toHaveCount(1);
	await expect(matches).toContainText("Original copy");
	await expect(matches).toContainText("Keeping: Newest copy");
	await page.screenshot({
		path: testInfo.outputPath("cleanup-duplicates.png"),
		animations: "disabled",
	});
	await dialog.getByRole("button", { name: "Delete selection (1)", exact: true }).click();
	const review = page.getByRole("dialog", { name: "Review deletion", exact: true });
	await expect(review).toBeVisible();
	await review.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(page.getByRole("button", { name: "Original copy", exact: true })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await page.getByRole("textbox", { name: "Search", exact: true }).fill("Recent");
	await expect(page.getByRole("button", { name: "Review deletion…" })).toBeDisabled();
});

test("deletion requires review and cancel preserves files; partial deletion retains failed selection", async ({
	page,
}) => {
	await page.goto("/tests/ui/library-cleanup.html?partial");
	await page.getByRole("button", { name: "Select projects to delete" }).click();
	await page.getByRole("button", { name: "Original copy", exact: true }).click();
	await page.getByRole("button", { name: "Newest copy", exact: true }).click();
	await page.getByRole("button", { name: "Review deletion…" }).click();
	const review = page.getByRole("dialog", { name: "Review deletion", exact: true });
	await expect(
		review.getByRole("list", { name: "Items to delete" }).getByRole("listitem"),
	).toHaveCount(2);
	await review.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(page.locator("html")).not.toHaveAttribute("data-deleted");
	await page.getByRole("button", { name: "Review deletion…" }).click();
	await review.getByRole("button", { name: "Move to Trash", exact: true }).click();
	await expect(review).not.toBeVisible();
	await expect(page.getByRole("button", { name: "Original copy", exact: true })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await expect(page.getByRole("button", { name: "Newest copy", exact: true })).toHaveCount(0);
});

test("source cleanup protects referenced companions and preserves a duplicate keeper", async ({
	page,
}) => {
	await page.goto("/tests/ui/library-cleanup.html");
	await page.getByRole("button", { name: "Raw files", exact: true }).click();
	await page.getByRole("button", { name: "Clean up", exact: true }).click();
	const matches = cleanup(page).getByRole("list", { name: "Cleanup matches" });
	await expect(matches.getByRole("checkbox")).toHaveCount(2);
	await expect(matches).not.toContainText("same.mic.wav");
	await option(page, "Find", "Duplicates of original");
	await expect(matches.getByRole("checkbox")).toHaveCount(1);
	await expect(matches).toContainText("duplicate.mp4");
	await expect(matches.locator("video")).toHaveAttribute("poster", /^data:image\/svg\+xml/);
	await expect(matches).toContainText("Keeping: same.mp4");
});

test("unreadable saved projects prevent source cleanup suggestions", async ({ page }) => {
	await page.goto("/tests/ui/library-cleanup.html?unreadable");
	await page.getByRole("button", { name: "Raw files", exact: true }).click();
	await page.getByRole("button", { name: "Clean up", exact: true }).click();
	await expect(cleanup(page)).toContainText("Some projects could not be checked");
	await expect(
		cleanup(page).getByRole("button", { name: "Delete selection (0)" }),
	).toBeDisabled();
});

test("custom dates and timestamp choice narrow matches; the dialog fits a narrow window", async ({
	page,
}, testInfo) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/tests/ui/library-cleanup.html");
	await page.getByRole("button", { name: "Clean up", exact: true }).click();
	const dialog = cleanup(page);
	const matches = dialog.getByRole("list", { name: "Cleanup matches" });
	await option(page, "Find", "All items");
	await expect(matches.getByRole("checkbox")).toHaveCount(3);
	await option(page, "Date based on", "Last created");
	await expect(matches.getByRole("checkbox")).toHaveCount(4);
	await option(page, "Date based on", "Last edited");
	await option(page, "Age", "Custom date range");
	const localDate = (daysAgo: number) => {
		const date = new Date(Date.now() - daysAgo * 86400000);
		return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
	};
	await dialog.getByLabel("From", { exact: true }).fill(localDate(3));
	await dialog.getByLabel("Through", { exact: true }).fill(localDate(1));
	await expect(matches.getByRole("checkbox")).toHaveCount(1);
	await expect(matches).toContainText("Recent take");
	await matches.getByRole("checkbox").focus();
	await matches.getByRole("checkbox").press("Space");
	await expect(matches.getByRole("checkbox")).not.toBeChecked();
	await matches.getByText("Recent take", { exact: true }).click();
	await expect(matches.getByRole("checkbox")).toBeChecked();
	await matches.getByText("Recent take", { exact: true }).click();
	await expect(dialog.getByRole("button", { name: "Delete selection (0)" })).toBeDisabled();
	const bounds = (await dialog.boundingBox())!;
	expect(bounds.x).toBeGreaterThanOrEqual(0);
	expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
	await page.screenshot({
		path: testInfo.outputPath("cleanup-narrow.png"),
		animations: "disabled",
	});
});

test("cleanup combines toggles and exposes an editable duration defaulting to five seconds", async ({
	page,
}) => {
	await page.goto("/tests/ui/library-cleanup.html");
	await page.getByRole("button", { name: "Clean up", exact: true }).click();
	const dialog = cleanup(page);
	await option(page, "Find", "Never exported");
	await expect(dialog.getByRole("button", { name: /Find/ })).toContainText(
		"Unedited & Not exported",
	);
	await option(page, "Find", "Never exported");
	await expect(dialog.getByRole("button", { name: /Find/ })).not.toContainText("Not exported");
	await option(page, "Find", "5 seconds or less");
	const threshold = dialog.getByRole("spinbutton", { name: "Duration (seconds)" });
	await expect(threshold).toHaveValue("5");
	await threshold.fill("0");
	await expect(dialog.getByRole("button", { name: /Delete selection/ })).toBeDisabled();
	await threshold.fill("0.5");
	await expect(
		dialog.getByRole("list", { name: "Cleanup matches" }).getByRole("checkbox"),
	).toHaveCount(0);
});

test("rapid duration edits run one scan and cannot delete using old threshold results", async ({
	page,
}) => {
	await page.goto("/tests/ui/library-cleanup.html");
	await page.getByRole("button", { name: "Clean up", exact: true }).click();
	const dialog = cleanup(page);
	await option(page, "Find", "5 seconds or less");
	const matches = dialog.getByRole("list", { name: "Cleanup matches" });
	await expect(matches.getByRole("checkbox")).toHaveCount(2);
	await page.evaluate(() => {
		const counters = { reads: 0, probes: 0 };
		Object.assign(window, { cleanupScanCounters: counters });
		const read = window.electronAPI.getProjectPreview.bind(window.electronAPI);
		const probe = window.electronAPI.probeNativeVideoMetadata.bind(window.electronAPI);
		window.electronAPI.getProjectPreview = async (...args) => {
			counters.reads++;
			return read(...args);
		};
		window.electronAPI.probeNativeVideoMetadata = async (...args) => {
			counters.probes++;
			return probe(...args);
		};
	});
	await page.clock.install();
	await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
	const counters = () =>
		page.evaluate(
			() =>
				(window as unknown as { cleanupScanCounters: { reads: number; probes: number } })
					.cleanupScanCounters,
		);
	const threshold = dialog.getByRole("spinbutton", { name: "Duration (seconds)" });
	const deletion = dialog.getByRole("button", { name: /Delete selection/ });
	for (const value of ["0.5", "10", "0.25"]) {
		await threshold.fill(value);
		await expect(deletion).toBeDisabled();
		await expect(matches.getByRole("checkbox")).toHaveCount(0);
		await page.clock.runFor(40);
	}
	await expect.poll(counters).toEqual({ reads: 0, probes: 0 });
	await page.clock.runFor(250);
	await expect.poll(counters).toEqual({ reads: 5, probes: 4 });
	await expect(dialog.getByRole("status").filter({ hasText: /^Matches: 0$/ })).toBeVisible();
	await expect(dialog.getByText("Checking saved projects and media…", { exact: true })).toHaveCount(0);
	await expect(matches.getByRole("checkbox")).toHaveCount(0);
	await expect(deletion).toBeDisabled();
	await page.clock.resume();
});
