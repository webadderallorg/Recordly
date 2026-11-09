import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function setup(page: Page) {
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
		const params = new URLSearchParams(location.search);
		const source = `/recordings/capture-${params.get("take") ?? "1"}.mp4`;
		const get = window.electronAPI.getAppSetting;
		const set = window.electronAPI.setAppSetting;
		window.electronAPI.getAppSetting = (key) => {
			if (key !== "recordly.editor.preferences") return get(key);
			const saved = localStorage.getItem(key);
			return saved
				? JSON.parse(saved)
				: params.get("auto") === "off"
					? { autoApplyFreshRecordingAutoZooms: false }
					: {};
		};
		window.electronAPI.setAppSetting = (key, value) => {
			if (key === "recordly.editor.preferences")
				document.documentElement.dataset.autoZoomPreference = JSON.stringify(
					(value as { autoApplyFreshRecordingAutoZooms?: boolean })
						.autoApplyFreshRecordingAutoZooms,
				);
			return set(key, value);
		};
		window.electronAPI.getCurrentRecordingSession = async () => ({
			success: true,
			session: { videoPath: source },
		});
		window.electronAPI.getLocalMediaUrl = async () => ({
			success: true,
			url: `${location.origin}/tests/ui/fixtures/filmstrip.mp4`,
		});
		let calls = 0;
		window.electronAPI.getCursorTelemetry = async () => ({
			success: true,
			samples:
				++calls === 1
					? []
					: [
							{ timeMs: 0, cx: 0.5, cy: 0.5, interactionType: "move" },
							{ timeMs: 3000, cx: 0.5, cy: 0.5, interactionType: "click" },
							{ timeMs: 3080, cx: 0.5, cy: 0.5, interactionType: "mouseup" },
							{ timeMs: 6000, cx: 0.5, cy: 0.5, interactionType: "move" },
						],
		});
	});
}

for (const take of [1, 4]) {
	test(`auto zooms default on for recording ${take} and stay removed after undo`, async ({
		page,
	}) => {
		await setup(page);
		await page.goto(`/?windowType=editor&take=${take}`);
		const zooms = page.locator('[data-variant="zoom"]');
		await expect(zooms).toHaveCount(1, { timeout: 20000 });
		await page.keyboard.press("Meta+z");
		await expect(zooms).toHaveCount(0);
		await page.getByRole("radio", { name: "Cursor", exact: true }).click();
		await page.getByRole("switch", { name: "Hide when idle", exact: true }).press("Space");
		await expect(zooms).toHaveCount(0);
	});
}

test("disabled automatic zooms show the primary manual action", async ({ page }) => {
	await setup(page);
	await page.goto("/?windowType=editor&auto=off");
	const apply = page.getByRole("button", { name: "Apply auto zooms", exact: true });
	await expect(apply).toBeVisible({ timeout: 20000 });
	await expect(apply).toHaveClass(/button--primary/);
	await expect(page.locator('[data-variant="zoom"]')).toHaveCount(0);
	await apply.click();
	await expect(page.locator('[data-variant="zoom"]')).toHaveCount(1);
});

test("Motion settings persist the auto zoom opt-out without removing existing zooms", async ({
	page,
}) => {
	await setup(page);
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="zoom"]')).toHaveCount(1, { timeout: 20000 });
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
	await dialog.getByRole("tab", { name: "Motion", exact: true }).click();
	const automatic = dialog.getByRole("switch", { name: "Automatically add zooms", exact: true });
	await expect(automatic).toBeChecked();
	await automatic.press("Space");
	await expect(automatic).not.toBeChecked();
	await expect(page.locator('[data-variant="zoom"]')).toHaveCount(1);
	await expect(page.locator("html")).toHaveAttribute("data-auto-zoom-preference", "false");
	await page.keyboard.press("Escape");
	await page.reload();
	await expect(page.getByRole("button", { name: "Apply auto zooms", exact: true })).toBeVisible({
		timeout: 20000,
	});
	await expect(page.locator('[data-variant="zoom"]')).toHaveCount(0);
});
