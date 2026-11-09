import { expect, test } from "@playwright/test";
import type { CursorTelemetryPoint } from "@/components/video-editor/types";
import { installDesktopBridge } from "./bridge";

for (const scenario of [
	{
		name: "recorded press and release",
		click: 3000,
		samples: [
			{ timeMs: 3000, cx: 0.5, cy: 0.5, interactionType: "click" },
			{ timeMs: 3080, cx: 0.5, cy: 0.5, interactionType: "mouseup" },
		],
		start: 2000,
		end: 4000,
	},
	{
		name: "strongest click in a group",
		click: 3000,
		samples: [
			{ timeMs: 2000, cx: 0.3, cy: 0.5, interactionType: "click" },
			{ timeMs: 3000, cx: 0.7, cy: 0.5, interactionType: "double-click" },
		],
		start: 1500,
		end: 4500,
	},
	{
		name: "recording boundary fallback",
		click: null,
		samples: [
			{ timeMs: 200, cx: 0.5, cy: 0.5, interactionType: "click" },
			{ timeMs: 250, cx: 0.5, cy: 0.5, interactionType: "mouseup" },
		],
		start: 0,
		end: 2000,
	},
] satisfies Array<{
	name: string;
	click: number | null;
	samples: CursorTelemetryPoint[];
	start: number;
	end: number;
}>) {
	test(`auto zoom placement: ${scenario.name}`, async ({ page }) => {
		await installDesktopBridge(page, "filmstrip.mp4");
		await page.addInitScript((samples) => {
			const getAppSetting = window.electronAPI.getAppSetting;
			window.electronAPI.getAppSetting = (key) =>
				key === "recordly.editor.preferences"
					? { autoApplyFreshRecordingAutoZooms: false }
					: getAppSetting(key);
			window.electronAPI.getCurrentRecordingSession = async () => ({
				success: true,
				session: { videoPath: `${location.origin}/tests/ui/fixtures/filmstrip.mp4` },
			});
			window.electronAPI.getCursorTelemetry = async () => ({
				success: true,
				samples: [
					{ timeMs: 0, cx: 0.5, cy: 0.5, interactionType: "move" },
					...samples,
					{ timeMs: 6000, cx: 0.5, cy: 0.5, interactionType: "move" },
				],
			});
		}, scenario.samples);
		await page.goto("/?windowType=editor");
		const suggest = page.getByRole("button", {
			name: "Apply auto zooms",
			exact: true,
		});
		await expect(suggest).toBeVisible({ timeout: 20000 });
		await expect(
			suggest.locator('xpath=ancestor::*[@data-timeline-row="row-zoom"]'),
		).toHaveCount(1);
		await expect(page.locator('[data-variant="clip"]')).toHaveCount(1);
		// With automatic zooms disabled, recordings stay unzoomed until requested.
		await page.waitForTimeout(900);
		await expect(page.locator('[data-variant="zoom"]')).toHaveCount(0);
		const zoomLane = page.locator('[data-timeline-row="row-zoom"]');
		await zoomLane.hover({ position: { x: 80, y: 20 } });
		await expect(zoomLane.getByTestId("timeline-add-preview")).toHaveCount(0);
		await zoomLane.click({ position: { x: 80, y: 20 } });
		await expect(page.locator('[data-variant="zoom"]')).toHaveCount(0);
		await expect(suggest).toBeVisible();
		if (scenario.name === "recorded press and release") {
			await page.screenshot({
				path: "test-results/manual-auto-zoom-before.png",
				animations: "disabled",
			});
		}
		await suggest.click();
		const zoom = page.locator('[data-variant="zoom"]');
		await expect(zoom).toHaveCount(1);
		await expect(zoom).toHaveAttribute("data-start-ms", String(scenario.start));
		await expect(zoom).toHaveAttribute("data-stored-end-ms", String(scenario.end));
		await expect(zoom.locator(".zoom-duration")).toHaveText(
			`${(scenario.end - scenario.start) / 1000}s`,
		);
		const block = (await zoom.locator(".timeline-block").boundingBox())!;
		const description = (await zoom.locator(".zoom-description").boundingBox())!;
		expect(description.x + description.width / 2).toBeCloseTo(block.x + block.width / 2, 0);
		expect(description.y + description.height / 2).toBeCloseTo(block.y + block.height / 2, 0);
		await expect(suggest).not.toBeVisible();
		if (scenario.click !== null) {
			const start = Number(await zoom.getAttribute("data-start-ms"));
			const end = Number(await zoom.getAttribute("data-stored-end-ms"));
			expect((start + end) / 2).toBe(scenario.click);
		}
		if (scenario.name === "recorded press and release") {
			const laneBounds = (await zoomLane.boundingBox())!;
			await zoomLane.hover({ position: { x: laneBounds.width * 0.7, y: 20 } });
			// A full two-second block does not fit between this point and the clip end.
			await expect(zoomLane.getByTestId("timeline-add-preview")).toHaveCount(0);
			await page.screenshot({
				path: "test-results/manual-auto-zoom-after.png",
				animations: "disabled",
			});
			await page.keyboard.press("Meta+z");
			await expect(zoom).toHaveCount(0);
			await expect(suggest).toBeVisible();
			await expect(zoomLane.getByTestId("timeline-add-preview")).toHaveCount(0);
			await page.waitForTimeout(900);
			await expect(zoom).toHaveCount(0);
			await suggest.click();
			await expect(zoom).toHaveCount(1);
		}
	});
}

test("auto zooms explain missing telemetry without adding a zoom", async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	const apply = page.getByRole("button", { name: "Apply auto zooms", exact: true });
	await expect(page.getByRole("button", { name: "Add Zoom (Z)", exact: true })).toBeVisible();
	await expect(apply).toHaveCount(0);
	await page.getByRole("button", { name: "Suggest Zooms from Cursor", exact: true }).click();
	await expect(page.getByText("No cursor telemetry available", { exact: true })).toBeVisible();
	await expect(page.locator('[data-variant="zoom"]')).toHaveCount(0);
	await expect(apply).toHaveCount(0);
});

for (const scenario of [
	{ name: "trimmed", speed: 1, duration: 3000, click: 3500, start: 500, end: 2500 },
	{ name: "sped up", speed: 2, duration: 2000, click: 4000, start: 0, end: 2000 },
]) {
	test(`auto zoom uses retained ${scenario.name} footage timestamps`, async ({ page }) => {
		test.setTimeout(90000);
		await installDesktopBridge(page, "filmstrip.mp4");
		await page.addInitScript(({ speed, duration, click }) => {
			window.electronAPI.loadCurrentProjectFile = async () => ({
				success: true,
				path: "/projects/trimmed.recordly",
				project: {
					version: 2,
					videoPath: `${location.origin}/tests/ui/fixtures/filmstrip.mp4`,
					editor: {
						clipRegions: [
							{
								id: "clip-1",
								startMs: 0,
								endMs: duration,
								sourceStartMs: 2000,
								speed,
							},
						],
					},
				},
			});
			window.electronAPI.getCursorTelemetry = async () => ({
				success: true,
				samples: [
					{ timeMs: 0, cx: 0.5, cy: 0.5, interactionType: "move" },
					{ timeMs: 100, cx: 0.1, cy: 0.1, interactionType: "click" },
					{ timeMs: 180, cx: 0.1, cy: 0.1, interactionType: "mouseup" },
					{ timeMs: click, cx: 0.7, cy: 0.5, interactionType: "click" },
					{ timeMs: click + 80, cx: 0.7, cy: 0.5, interactionType: "mouseup" },
					{ timeMs: 6000, cx: 0.5, cy: 0.5, interactionType: "move" },
				],
			});
		}, scenario);
		await page.goto("/?windowType=editor");
		await expect(page.locator('[data-variant="clip"]')).toHaveAttribute(
			"data-end-ms",
			String(scenario.duration),
			{ timeout: 20000 },
		);
		await page.getByRole("button", { name: "Apply auto zooms", exact: true }).click();
		const zoom = page.locator('[data-variant="zoom"]');
		await expect(zoom).toHaveCount(1);
		await expect(zoom).toHaveAttribute("data-start-ms", String(scenario.start));
		await expect(zoom).toHaveAttribute("data-stored-end-ms", String(scenario.end));
	});
}
