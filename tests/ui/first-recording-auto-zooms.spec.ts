import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

for (const recording of [1, 2, 3, 4]) {
	test(`recording ${recording}: ${recording <= 3 ? "automatically applies zooms once" : "keeps auto zooms manual"}`, async ({
		page,
	}) => {
		await installDesktopBridge(page, "filmstrip.mp4");
		await page.addInitScript((index) => {
			window.sessionStorage.setItem("trial-recording", String(index));
		}, recording);
		await installDesktopBridgeOverrides(page, () => {
			const index = Number(sessionStorage.getItem("trial-recording"));
			const source = `/recordings/trial-${index}.mp4`;
			let handled = false;
			window.electronAPI.claimFirstRecordingAutoZooms = async (path) => {
				if (path !== source || index > 3 || handled) return false;
				handled = true;
				return true;
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
		await page.goto("/?windowType=editor");
		await expect(page.locator(".editor-preview-frame")).toHaveClass(/loading-content-enter/, {
			timeout: 20000,
		});
		const zooms = page.locator('[data-variant="zoom"]');
		if (recording <= 3) {
			await expect(zooms).toHaveCount(1);
			await page.keyboard.press("Meta+z");
			await expect(zooms).toHaveCount(0);
			await page.getByRole("radio", { name: "Cursor", exact: true }).click();
			await page.getByRole("switch", { name: "Hide when idle", exact: true }).press("Space");
			await expect(zooms).toHaveCount(0);
		} else {
			await expect(
				page.getByRole("button", { name: "Apply auto zooms", exact: true }),
			).toBeVisible();
			await expect(zooms).toHaveCount(0);
			await page.getByRole("button", { name: "Apply auto zooms", exact: true }).click();
			await expect(zooms).toHaveCount(1);
		}
	});
}
