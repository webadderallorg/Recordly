import { expect, test } from "@playwright/test";

test("burst shoots grey rays from the click, then separates and fades in playback and export", async ({
	page,
}, testInfo) => {
	await page.route("**/burst-audit.html", (route) =>
		route.fulfill({ contentType: "text/html", body: "<!doctype html><body></body>" }),
	);
	await page.goto("/burst-audit.html");
	const frames = await page.evaluate(async () => {
		const { Application, Graphics } = await import("/tests/ui/pixiAudit.ts");
		const { drawClickEffectGraphics, drawClickEffectOnCanvas } = await import(
			"/src/components/video-editor/videoPlayback/cursorClickEffects.ts"
		);
		const { getCursorVisualState } = await import(
			"/src/components/video-editor/videoPlayback/cursorVisualState.ts"
		);
		const { normalizeCursorClickEffectStyle } = await import(
			"/src/components/video-editor/types.ts"
		);
		if (normalizeCursorClickEffectStyle("burst") !== "burst")
			throw new Error("Burst must survive project loading");
		const app = new Application();
		await app.init({
			width: 200,
			height: 200,
			backgroundAlpha: 0,
			resolution: 1,
			antialias: true,
		});
		const graphics = new Graphics();
		app.stage.addChild(graphics);
		const samples = [{ timeMs: 0, cx: 0.5, cy: 0.5, interactionType: "click", mouseButton: 1 }];
		function measure(canvas: HTMLCanvasElement) {
			const pixels = canvas.getContext("2d")!.getImageData(0, 0, 200, 200).data;
			const visited = new Set<number>();
			let components = 0,
				minY = 200,
				innerRadius = 200,
				maxAlpha = 0,
				colorOffset = 0;
			for (let i = 0; i < 40000; i++) {
				if (pixels[i * 4 + 3] < 10) continue;
				minY = Math.min(minY, Math.floor(i / 200));
				innerRadius = Math.min(
					innerRadius,
					Math.hypot((i % 200) - 100, Math.floor(i / 200) - 100),
				);
				if (pixels[i * 4 + 3] > maxAlpha) {
					maxAlpha = pixels[i * 4 + 3];
					colorOffset = i * 4;
				}
				if (visited.has(i)) continue;
				components++;
				const queue = [i];
				visited.add(i);
				while (queue.length) {
					const point = queue.pop()!;
					for (const offset of [-201, -200, -199, -1, 1, 199, 200, 201]) {
						const next = point + offset;
						if (
							next >= 0 &&
							next < 40000 &&
							!visited.has(next) &&
							pixels[next * 4 + 3] >= 10
						) {
							visited.add(next);
							queue.push(next);
						}
					}
				}
			}
			const top = Array.from(pixels.slice(colorOffset, colorOffset + 3));
			return {
				components,
				innerRadius,
				minY,
				maxAlpha,
				top,
				centerAlpha: pixels[(100 * 200 + 100) * 4 + 3],
			};
		}
		document.body.style.cssText =
			"display:grid;grid-template-columns:200px 200px;background:#222;color:white;font:16px system-ui";
		const frames = [];
		for (const time of [30, 90, 180, 350, 90]) {
			const { clickProgress } = getCursorVisualState(
				samples,
				time,
				180,
				600,
				"dot",
				1,
				"burst",
			);
			const args = ["burst", 100, 100, 32, clickProgress, 1, 1] as const;
			drawClickEffectGraphics(graphics, ...args);
			app.render();
			const preview = document.createElement("canvas");
			preview.width = preview.height = 200;
			preview.getContext("2d")!.drawImage(app.canvas, 0, 0);
			const exported = document.createElement("canvas");
			exported.width = exported.height = 200;
			drawClickEffectOnCanvas(exported.getContext("2d")!, ...args);
			frames.push({ preview: measure(preview), exported: measure(exported) });
			const label = document.createElement("div");
			label.style.gridColumn = "span 2";
			label.textContent = `${time} ms — preview / export`;
			document.body.append(label, preview, exported);
		}
		app.destroy(true);
		return frames;
	});
	await page.screenshot({ path: testInfo.outputPath("burst-frames.png"), fullPage: true });
	for (const mode of ["preview", "exported"] as const) {
		for (const index of [0, 1, 2]) {
			const frame = frames[index][mode];
			if (index === 0) expect(frame.components).toBeGreaterThan(0);
			else expect(frame.components).toBe(10);
			expect(frame.centerAlpha).toBe(0);
			for (const [channel, expected] of [156, 163, 175].entries()) {
				// Transparent edge pixels can differ slightly after unpremultiplication.
				expect(Math.abs(frame.top[channel] - expected)).toBeLessThanOrEqual(3);
			}
		}
		expect(frames[0][mode].innerRadius).toBeLessThan(8);
		expect(frames[1][mode].innerRadius).toBeGreaterThan(20);
		expect(100 - frames[2][mode].minY).toBeGreaterThan((100 - frames[0][mode].minY) * 2);
		expect(frames[2][mode].maxAlpha).toBeLessThan(frames[0][mode].maxAlpha);
		expect(frames[3][mode].components).toBe(0);
		expect(frames[4][mode]).toEqual(frames[1][mode]);
	}
	for (const frame of frames) {
		expect(Math.abs(frame.preview.minY - frame.exported.minY)).toBeLessThanOrEqual(1);
		expect(
			Math.abs(frame.preview.maxAlpha - frame.exported.maxAlpha),
			JSON.stringify(frames),
		).toBeLessThanOrEqual(1);
	}
});
