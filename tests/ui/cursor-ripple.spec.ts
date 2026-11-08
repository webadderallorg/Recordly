import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("all click effects select grey for the recording and previews", async ({ page }, testInfo) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	await page.getByRole("radio", { name: "Cursor", exact: true }).click();
	const choices = page.getByRole("grid", { name: "Click Effects", exact: true });
	await expect(choices.getByRole("row")).toHaveCount(4);
	await expect(choices.getByRole("row", { name: "Off", exact: true })).toHaveCount(0);
	for (const name of ["Spotlight", "Echo", "Burst"]) {
		const effect = choices.getByRole("row", { name, exact: true });
		await effect.click();
		await expect(effect).toHaveAttribute("aria-selected", "true");
		await expect(effect.locator("svg")).toHaveCSS("color", "rgb(156, 163, 175)");
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						JSON.parse(localStorage.getItem("recordly.editor.preferences") ?? "{}")
							.cursorClickEffectColor,
				),
			)
			.toBe("#9CA3AF");
	}
	const ripple = page.getByRole("row", { name: "Ripple", exact: true });
	await ripple.click();
	await expect(ripple).toHaveAttribute("aria-selected", "true");
	await expect(ripple.locator("svg")).toHaveCSS("color", "rgb(156, 163, 175)");
	await expect(ripple.locator("circle")).toHaveAttribute("fill", "currentColor");
	await ripple.click();
	await expect(ripple).toHaveAttribute("aria-selected", "false");
	await ripple.press("Enter");
	await expect(ripple).toHaveAttribute("aria-selected", "true");
	await ripple.press("Enter");
	await expect(ripple).toHaveAttribute("aria-selected", "false");
	await ripple.click();
	await page.reload();
	await page.getByRole("radio", { name: "Cursor", exact: true }).click();
	await expect(ripple).toHaveAttribute("aria-selected", "true");
	await expect(ripple.locator("svg")).toHaveCSS("color", "rgb(156, 163, 175)");
	const burst = page.getByRole("row", { name: "Burst", exact: true });
	await burst.click();
	await expect(burst).toHaveAttribute("aria-selected", "true");
	await expect(ripple).toHaveAttribute("aria-selected", "false");
	await expect(burst.locator("svg path")).toHaveCount(10);
	await expect(burst.locator("svg")).toHaveCSS("color", "rgb(156, 163, 175)");
	await page.reload();
	await page.getByRole("radio", { name: "Cursor", exact: true }).click();
	await expect(burst).toHaveAttribute("aria-selected", "true");
	await choices.screenshot({ path: testInfo.outputPath("click-effects.png") });
	await burst.click();
	await expect(burst).toHaveAttribute("aria-selected", "false");
});

test("gray ripple expands and fades completely while held in preview and export", async ({
	page,
}, testInfo) => {
	await page.route("**/ripple-audit.html", (route) =>
		route.fulfill({ contentType: "text/html", body: "<!doctype html><body></body>" }),
	);
	await page.goto("/ripple-audit.html");
	const frames = await page.evaluate(async () => {
		const { Application, Graphics } = await import("/tests/ui/pixiAudit.ts");
		const { drawClickEffectGraphics, drawClickEffectOnCanvas } = await import(
			"/src/components/video-editor/videoPlayback/cursorClickEffects.ts"
		);
		const { getCursorVisualState } = await import(
			"/src/components/video-editor/videoPlayback/cursorVisualState.ts"
		);
		const { DEFAULT_CURSOR_RIPPLE_COLOR } = await import(
			"/src/components/video-editor/types.ts"
		);
		const app = new Application();
		await app.init({ width: 200, height: 200, backgroundAlpha: 0, resolution: 1 });
		const graphics = new Graphics();
		app.stage.addChild(graphics);
		const samples = [
			{ timeMs: 0, cx: 0.5, cy: 0.5, interactionType: "click", mouseButton: 1 },
			{ timeMs: 400, cx: 0.5, cy: 0.5, interactionType: "mouseup", mouseButton: 1 },
		];
		function measure(canvas: HTMLCanvasElement) {
			const pixels = canvas.getContext("2d")!.getImageData(0, 0, 200, 200).data;
			let left = 200;
			let right = -1;
			for (let x = 0; x < 200; x++) {
				if (pixels[(100 * 200 + x) * 4 + 3] > 3) {
					left = Math.min(left, x);
					right = Math.max(right, x);
				}
			}
			return {
				width: Math.max(0, right - left + 1),
				center: Array.from(pixels.slice((100 * 200 + 100) * 4, (100 * 200 + 100) * 4 + 4)),
			};
		}
		document.body.style.cssText =
			"display:grid;grid-template-columns:200px 200px;background:white;color:#333;font:16px system-ui";
		const results = [];
		for (const time of [30, 90, 180, 240, 350, 90, 550]) {
			const { clickProgress } = getCursorVisualState(
				samples,
				time,
				180,
				600,
				"dot",
				1,
				"ripple",
			);
			const args = [
				"ripple",
				100,
				100,
				32,
				clickProgress,
				1,
				1,
				DEFAULT_CURSOR_RIPPLE_COLOR,
			] as const;
			drawClickEffectGraphics(graphics, ...args);
			app.render();
			const preview = document.createElement("canvas");
			preview.width = preview.height = 200;
			preview.getContext("2d")!.drawImage(app.canvas, 0, 0);
			const exported = document.createElement("canvas");
			exported.width = exported.height = 200;
			drawClickEffectOnCanvas(exported.getContext("2d")!, ...args);
			results.push({ time, preview: measure(preview), exported: measure(exported) });
			const label = document.createElement("div");
			label.style.gridColumn = "span 2";
			label.textContent = `${time} ms — preview / export`;
			document.body.append(label, preview, exported);
		}
		app.destroy(true);
		return results;
	});
	await page.screenshot({ path: testInfo.outputPath("ripple-frames.png"), fullPage: true });
	for (const mode of ["preview", "exported"] as const) {
		expect(frames[1][mode].width).toBeGreaterThan(frames[0][mode].width);
		expect(frames[2][mode].width).toBeGreaterThan(frames[1][mode].width);
		for (const index of [1, 2, 3]) {
			expect(frames[index][mode].center[3]).toBeLessThan(frames[index - 1][mode].center[3]);
		}
		expect(frames[4][mode].width).toBe(0);
		expect(frames[5][mode]).toEqual(frames[1][mode]);
		expect(frames[6][mode].width).toBe(0);
	}
	for (const frame of frames.filter((frame) => frame.time < 300)) {
		for (const result of [frame.preview, frame.exported]) {
			expect(result.center[3]).toBeGreaterThan(0);
			for (const [i, channel] of [156, 163, 175].entries()) {
				expect(Math.abs(result.center[i] - channel)).toBeLessThanOrEqual(8);
			}
		}
		expect(Math.abs(frame.preview.width - frame.exported.width)).toBeLessThanOrEqual(2);
		expect(Math.abs(frame.preview.center[3] - frame.exported.center[3])).toBeLessThanOrEqual(1);
	}
});
