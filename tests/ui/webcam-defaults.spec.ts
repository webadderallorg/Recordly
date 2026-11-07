import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

for (const savedRoundness of [undefined, 0, 69, 100]) {
	test(`squircle camera uses ${savedRoundness === undefined ? "50% by default" : `saved ${savedRoundness}% roundness`}`, async ({
		page,
	}) => {
		await installDesktopBridge(page);
		await installDesktopBridgeOverrides(
			page,
			(roundness) => {
				{
					const getAppSetting = window.electronAPI.getAppSetting;
					window.electronAPI.getAppSetting = (key) =>
						key === "recordly.editor.preferences"
							? { webcam: { shape: "squircle", roundness } }
							: getAppSetting(key);
				}
				window.electronAPI.getCurrentRecordingSession = async () => ({
					success: true,
					session: {
						videoPath: `${location.origin}/tests/ui/fixtures/preview.mp4`,
						webcamPath: `${location.origin}/tests/ui/fixtures/preview.mp4`,
						timeOffsetMs: 0,
					},
				});
			},
			savedRoundness,
		);
		await page.goto("/?windowType=editor");
		await page.getByRole("radio", { name: "Webcam", exact: true }).click();
		const expected = savedRoundness ?? 50;
		await expect(page.getByRole("slider", { name: "Webcam Roundness" })).toHaveValue(
			String(expected),
		);
		const mask = page.locator('div[style*="clip-path"][style*="contain: paint"]:has(video)');
		await expect(mask).toHaveCount(1);
		await expect
			.poll(async () =>
				mask.evaluate((node) => {
					const radius = Number(
						getComputedStyle(node).clipPath.match(/M\s+([\d.]+)/)?.[1],
					);
					const box = node.getBoundingClientRect();
					return Math.round(100 * (radius / (Math.min(box.width, box.height) / 2)));
				}),
			)
			.toBe(expected);
		// Full roundness should soften the corners while keeping a squircle.
		if (expected === 100) {
			const shape = await mask.evaluate((node) => {
				const element = node as HTMLElement;
				const previousPointerEvents = element.style.pointerEvents;
				element.style.pointerEvents = "auto";
				const box = node.getBoundingClientRect();
				const x = box.left + box.width * 0.08;
				const y = box.top + box.height * 0.08;
				const result = {
					clipPath: getComputedStyle(node).clipPath,
					// Inside a squircle, outside a circle: catches accidentally switching shapes.
					squircleShoulderVisible: document
						.elementsFromPoint(box.left + box.width * 0.13, box.top + box.height * 0.13)
						.includes(node),
					cornerVisible: document.elementsFromPoint(x, y).includes(node),
					centerVisible: document
						.elementsFromPoint(box.left + box.width / 2, box.top + box.height / 2)
						.includes(node),
				};
				element.style.pointerEvents = previousPointerEvents;
				return result;
			});
			expect(shape.clipPath).toMatch(/^path\(/);
			expect(shape.squircleShoulderVisible).toBe(true);
			expect(shape.cornerVisible).toBe(false);
			expect(shape.centerVisible).toBe(true);
		}
		await page.screenshot({
			path: `test-results/webcam-new-recording-${expected}.png`,
			animations: "disabled",
		});
	});
}

test("new recordings default to a circle and retain the squircle option", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getCurrentRecordingSession = async () => ({
			success: true,
			session: {
				videoPath: `${location.origin}/tests/ui/fixtures/preview.mp4`,
				webcamPath: `${location.origin}/tests/ui/fixtures/preview.mp4`,
				timeOffsetMs: 0,
			},
		});
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("radio", { name: "Webcam", exact: true }).click();
	const circle = page.getByRole("row", { name: "Circle", exact: true });
	await expect(circle).toHaveAttribute("aria-selected", "true");
	await page.getByRole("switch", { name: "Advanced settings" }).press("Space");
	await expect(page.getByRole("slider", { name: "Webcam Shadow" })).toHaveValue("0.2");
	const mask = page.locator('div[style*="clip-path"][style*="contain: paint"]:has(video)');
	await expect(mask).toHaveCSS("clip-path", "circle(50% at 50% 50%)");
	await expect(page.getByRole("slider", { name: "Webcam Roundness" })).toHaveCount(0);
	const width = page.getByRole("slider", { name: "Webcam Width" });
	await width.focus();
	await width.press("ArrowRight");
	await expect
		.poll(() =>
			mask.evaluate((el) => {
				const box = el.getBoundingClientRect();
				return Math.abs(box.width - box.height);
			}),
		)
		.toBeLessThan(1);
	await page.screenshot({
		path: "test-results/webcam-circle-default.png",
		animations: "disabled",
	});
	await page.getByRole("row", { name: "Square", exact: true }).click();
	await expect(page.getByRole("slider", { name: "Webcam Roundness" })).toHaveValue("50");
	await expect(mask).toHaveCSS("clip-path", /^path\(/);
	await circle.click();
	await expect(mask).toHaveCSS("clip-path", "circle(50% at 50% 50%)");
});

test("Rectangle starts at 60% width, keeps Square roundness", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getCurrentRecordingSession = async () => ({
			success: true,
			session: {
				videoPath: `${location.origin}/tests/ui/fixtures/preview.mp4`,
				webcamPath: `${location.origin}/tests/ui/fixtures/preview.mp4`,
				timeOffsetMs: 0,
			},
		});
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("radio", { name: "Webcam", exact: true }).click();
	await page.getByRole("row", { name: "Square", exact: true }).click();
	const roundness = page.getByRole("slider", { name: "Webcam Roundness" });
	await roundness.focus();
	await roundness.press("Home");
	for (let step = 0; step < 25; step++) await roundness.press("ArrowRight");
	await expect(roundness).toHaveValue("25");
	await page.getByRole("row", { name: "Rectangle", exact: true }).click();
	await expect(page.getByRole("slider", { name: "Webcam Width" })).toHaveValue("60");
	await expect(page.getByRole("slider", { name: "Webcam Height" })).toHaveValue("40");
	await expect(roundness).toHaveValue("25");
	await expect(page.locator("[data-webcam-overlay]")).toHaveAttribute(
		"data-webcam-ready",
		"true",
	);
	await page.screenshot({
		path: "test-results/webcam-rectangle-geometry.png",
		animations: "disabled",
	});
	await page.getByRole("row", { name: "Square", exact: true }).click();
	await expect(roundness).toHaveValue("25");
	await expect
		.poll(() =>
			page.locator("[data-webcam-overlay]").evaluate((element) => {
				const box = element.getBoundingClientRect();
				return Math.abs(box.width - box.height);
			}),
		)
		.toBeLessThan(1);
});
