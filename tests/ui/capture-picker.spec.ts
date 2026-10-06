import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

// Front to back: Notes overlaps the left part of Safari.
const windows = [
	{
		id: "window:101:0",
		appName: "Notes",
		title: "Launch checklist",
		display_id: "1",
		x: 160,
		y: 140,
		width: 620,
		height: 460,
	},
	{
		id: "window:102:0",
		appName: "Safari",
		title: "Release notes",
		display_id: "1",
		x: 520,
		y: 220,
		width: 760,
		height: 560,
	},
];

async function openPicker(page: Page, allowArea = true) {
	await installDesktopBridge(page);
	await page.addInitScript(
		({ pickerWindows, allowArea }) => {
			const api = (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI;
			Object.assign(api, {
				getCapturePickerContext: async () => ({
					displayBounds: { x: 0, y: 0, width: 1440, height: 1000 },
					lastArea: null,
					allowArea,
					windows: pickerWindows,
					cursor: null,
				}),
				completeCapturePick: async (pick: unknown) => {
					document.documentElement.dataset.pick = JSON.stringify(pick);
				},
				capturePickerReady: () => {
					document.documentElement.dataset.pickerReady = "true";
				},
			});
		},
		{ pickerWindows: windows, allowArea },
	);
	await page.goto("/?windowType=capture-picker&displayId=1");
	await expect(page.locator("html")).toHaveAttribute("data-picker-ready", "true");
}

async function pick(page: Page) {
	const value = await page.locator("html").getAttribute("data-pick");
	return value ? JSON.parse(value) : undefined;
}

test("hovering highlights the frontmost window and a click picks it", async ({ page }) => {
	await openPicker(page);
	await page.mouse.move(600, 300);
	await expect(page.getByText("Notes — Launch checklist · 620 × 460")).toBeVisible();

	await page.mouse.click(600, 300);
	expect(await pick(page)).toEqual({
		kind: "window",
		windowId: "window:101:0",
		displayId: 1,
		record: false,
	});
});

test("a click on the desktop picks the whole screen", async ({ page }) => {
	await openPicker(page);
	await page.mouse.move(1380, 60);
	await expect(page.getByText("Entire screen · 1440 × 1000")).toBeVisible();

	await page.mouse.click(1380, 60);
	expect(await pick(page)).toEqual({ kind: "screen", displayId: 1, record: false });
});

test("a drag draws an area", async ({ page }) => {
	await openPicker(page);
	await page.mouse.move(300, 200);
	await page.mouse.down();
	await page.mouse.move(700, 450, { steps: 8 });
	await page.mouse.up();
	await expect(page.getByText("Area · 400 × 250")).toBeVisible();
	expect(await pick(page)).toBeUndefined();
	await page.keyboard.press("Enter");

	expect(await pick(page)).toMatchObject({
		kind: "area",
		width: 400,
		height: 250,
		displayId: 1,
		record: false,
	});
});

test("Escape cancels", async ({ page }) => {
	await openPicker(page);
	await page.keyboard.press("Escape");
	expect(await pick(page)).toBeNull();
});

test("selection has no recording toolbar", async ({ page }) => {
	await openPicker(page);
	await page.mouse.click(600, 300);
	await expect(page.getByRole("button", { name: "Record", exact: true })).toHaveCount(0);
	expect(await pick(page)).toMatchObject({ kind: "window", record: false });
});

test("platforms without area capture keep drag selection on an existing screen", async ({
	page,
}) => {
	await openPicker(page, false);
	await page.mouse.move(1300, 100);
	await page.mouse.down();
	await page.mouse.move(1380, 180, { steps: 8 });
	await page.mouse.up();
	expect(await pick(page)).toMatchObject({ kind: "screen", record: false });
});

for (const { selected, trigger } of [
	{ selected: false, trigger: "source" },
	{ selected: false, trigger: "record" },
	{ selected: true, trigger: "source" },
]) {
	test(`HUD ${selected ? "keeps the selected source" : "starts without a selected source"} and opens the picker only on ${trigger} click`, async ({
		page,
	}) => {
		await installDesktopBridge(page);
		await page.addInitScript((selected) => {
			Object.assign(window.electronAPI, {
				getSelectedSource: async () =>
					selected ? { id: "screen:1:0", name: "Existing screen" } : null,
				pickCaptureTarget: async () => {
					const html = document.documentElement;
					html.dataset.pickerCalls = String(Number(html.dataset.pickerCalls ?? 0) + 1);
					return {
						success: true,
						source: { id: "window:101:0", name: "Selected window" },
					};
				},
			});
		}, selected);
		await page.goto("/?windowType=hud-overlay");
		const control = page.getByRole("button", { name: "Choose recording source" });
		await expect(control).toBeEnabled();
		if (selected) {
			await expect(control).toContainText("Existing screen");
		} else {
			await expect(control).toHaveText("Pick source");
		}
		await expect(page.locator("html")).not.toHaveAttribute("data-picker-calls");
		await (trigger === "source"
			? control
			: page.getByRole("button", { name: "Record", exact: true })).click();
		await expect(page.locator("html")).toHaveAttribute("data-picker-calls", "1");
		await expect(control).toContainText("Selected window");
		await expect(page.getByRole("button", { name: "Record", exact: true })).toBeVisible();
	});
}

test("a newer selected-source event wins over the startup response", async ({ page }) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		Object.assign(window.electronAPI, {
			getSelectedSource: async () => {
				await new Promise((resolve) => setTimeout(resolve, 100));
				document.documentElement.dataset.sourceResolved = "true";
				return null;
			},
			onSelectedSourceChanged: (listener: (source: { name: string }) => void) => {
				const timer = setTimeout(() => listener({ name: "Newer window" }), 10);
				return () => clearTimeout(timer);
			},
			pickCaptureTarget: async () => {
				document.documentElement.dataset.pickerCalls = "1";
				return { success: false, canceled: true };
			},
		});
	});
	await page.goto("/?windowType=hud-overlay");
	await expect(page.locator("html")).toHaveAttribute("data-source-resolved", "true");
	await expect(page.getByRole("button", { name: "Choose recording source" })).toContainText(
		"Newer window",
	);
	await expect(page.locator("html")).not.toHaveAttribute("data-picker-calls");
});

test("areas can be moved and resized before Enter confirms them", async ({ page }) => {
	await openPicker(page);
	await page.mouse.move(300, 200);
	await page.mouse.down();
	await page.mouse.move(700, 450, { steps: 8 });
	await page.mouse.up();
	await expect(page.getByText("Area · 400 × 250")).toBeVisible();
	await page.mouse.move(400, 300);
	await page.mouse.down();
	await page.mouse.move(450, 350, { steps: 5 });
	await page.mouse.up();
	expect(await pick(page)).toBeUndefined();
	const corner = page.locator('[data-area-handle="se"]');
	const bounds = await corner.boundingBox();
	if (!bounds) throw new Error("Missing area resize handle");
	await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
	await page.mouse.down();
	await page.mouse.move(850, 600, { steps: 5 });
	await page.mouse.up();
	await expect(page.getByText("Area · 500 × 350")).toBeVisible();
	await page.keyboard.press("Enter");
	expect(await pick(page)).toMatchObject({
		kind: "area",
		x: 350,
		y: 250,
		width: 500,
		height: 350,
		record: false,
	});
});

test("unselected source reads Pick source once and Record stays disabled while picking", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		Object.assign(window.electronAPI, {
			getSelectedSource: async () => null,
			pickCaptureTarget: async () =>
				new Promise((resolve) => {
					(window as unknown as { finishPicker: () => void }).finishPicker = () =>
						resolve({ success: false, canceled: true });
					document.documentElement.dataset.pickerPending = "true";
				}),
		});
	});
	await page.goto("/?windowType=hud-overlay");
	const source = page.getByRole("button", { name: "Choose recording source" });
	await expect(source).toBeEnabled();
	await expect(source).toHaveText("Pick source");
	await expect(page.locator("html")).not.toHaveAttribute("data-picker-pending");
	await source.click();
	await expect(page.locator("html")).toHaveAttribute("data-picker-pending", "true");
	await expect(page.getByRole("button", { name: "Record", exact: true })).toBeDisabled();
	await page.evaluate(() => (window as unknown as { finishPicker: () => void }).finishPicker());
	await expect(page.getByRole("button", { name: "Record", exact: true })).toBeEnabled();
	await expect(source).toHaveText("Pick source");
});
