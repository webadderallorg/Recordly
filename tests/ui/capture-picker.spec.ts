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

async function openPicker(page: Page) {
	await installDesktopBridge(page);
	await page.addInitScript((pickerWindows) => {
		const api = (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI;
		Object.assign(api, {
			getCapturePickerContext: async () => ({
				displayBounds: { x: 0, y: 0, width: 1440, height: 1000 },
				lastArea: null,
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
	}, windows);
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
	await page.getByRole("button", { name: "Record" }).click();
	expect(await pick(page)).toEqual({
		kind: "window",
		windowId: "window:101:0",
		displayId: 1,
		record: true,
	});
});

test("a click on the desktop picks the whole screen", async ({ page }) => {
	await openPicker(page);
	await page.mouse.move(1380, 60);
	await expect(page.getByText("Entire screen · 1440 × 1000")).toBeVisible();

	await page.mouse.click(1380, 60);
	await page.getByRole("button", { name: "Select" }).click();
	expect(await pick(page)).toEqual({ kind: "screen", displayId: 1, record: false });
});

test("a drag draws an area", async ({ page }) => {
	await openPicker(page);
	await page.mouse.move(300, 200);
	await page.mouse.down();
	await page.mouse.move(700, 450, { steps: 8 });
	await page.mouse.up();
	await expect(page.getByText("400 × 250")).toBeVisible();

	await page.keyboard.press("Enter");
	expect(await pick(page)).toMatchObject({
		kind: "area",
		width: 400,
		height: 250,
		displayId: 1,
		record: true,
	});
});

test("Escape cancels", async ({ page }) => {
	await openPicker(page);
	await page.keyboard.press("Escape");
	expect(await pick(page)).toBeNull();
});
