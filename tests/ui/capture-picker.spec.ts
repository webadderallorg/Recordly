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
	await expect(page.getByText("400 × 250")).toBeVisible();

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

for (const selected of [false, true]) {
	test(`HUD ${selected ? "keeps the selected source and reopens on click" : "opens the picker once when no source exists"}`, async ({
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
		await expect(control).toBeVisible();
		if (selected) {
			await expect(control).toContainText("Existing screen");
			await expect(page.locator("html")).not.toHaveAttribute("data-picker-calls");
			await control.click();
		}
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
