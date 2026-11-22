import { expect, test } from "@playwright/test";

test("idle fades match preview and canvas rendering, including seeking and disabling", async ({
	page,
}) => {
	await page.route("**/cursor-idle-audit.html", (route) =>
		route.fulfill({ contentType: "text/html", body: "<!doctype html><body></body>" }),
	);
	await page.goto("/cursor-idle-audit.html");
	const frames = await page.evaluate(async () => {
		const renderer = await import(
			"/src/components/video-editor/videoPlayback/cursorRenderer.ts"
		);
		await renderer.preloadCursorAssets();
		const { Application } = await import("/tests/ui/pixiAudit.ts");
		const app = new Application();
		await app.init({ width: 400, height: 200, backgroundAlpha: 0, resolution: 1 });
		const config = { ...renderer.DEFAULT_CURSOR_CONFIG, style: "dot", dotRadius: 100 };
		const samples = [
			{ timeMs: 0, cx: 0.5, cy: 0.5 },
			{ timeMs: 3000, cx: 0.5, cy: 0.5 },
			{ timeMs: 3100, cx: 0.8, cy: 0.5 },
		];
		const viewport = { x: 0, y: 0, width: 400, height: 200 };
		const overlay = new renderer.PixiCursorOverlay(config);
		app.stage.addChild(overlay.container);
		const alphaSum = (canvas: HTMLCanvasElement) => {
			const copy = document.createElement("canvas");
			copy.width = 400;
			copy.height = 200;
			const ctx = copy.getContext("2d")!;
			ctx.drawImage(canvas, 0, 0);
			const data = ctx.getImageData(0, 0, 400, 200).data;
			let sum = 0;
			for (let i = 3; i < data.length; i += 4) sum += data[i];
			return sum;
		};
		const results = [];
		for (const time of [
			0, 250, 500, 650, 800, 2000, 2999, 3000, 3037.5, 3075, 3112.5, 3150, 3275, 3075, 650,
		]) {
			overlay.update(samples, time, viewport, true, true);
			app.render();
			const canvas = document.createElement("canvas");
			canvas.width = 400;
			canvas.height = 200;
			renderer.drawCursorOnCanvas(
				canvas.getContext("2d")!,
				samples,
				time,
				viewport,
				new renderer.SmoothedCursorState(config),
				config,
			);
			results.push({ time, preview: alphaSum(app.canvas), canvas: alphaSum(canvas) });
		}
		overlay.setIdleHideSettings({ ...config.idleHide, enabled: false });
		overlay.update(samples, 2000, viewport, true, true);
		app.render();
		const disabled = alphaSum(app.canvas);
		overlay.destroy();
		app.destroy(true);
		return { results, disabled };
	});
	for (const backend of ["preview", "canvas"] as const) {
		const full = frames.results[0][backend];
		expect(full).toBeGreaterThan(1000);
		for (const frame of frames.results) {
			if ([800, 2000, 2999, 3000].includes(frame.time)) expect(frame[backend]).toBe(0);
			else if (frame.time === 650) expect(frame[backend] / full).toBeCloseTo(0.5, 1);
			else if (frame.time > 3000 && frame.time < 3150) {
				const progress = (frame.time - 3000) / 150;
				expect(frame[backend] / full).toBeCloseTo(
					progress * progress * (3 - 2 * progress),
					1,
				);
			} else expect(frame[backend] / full).toBeCloseTo(1, 1);
		}
	}
	expect(frames.disabled / frames.results[0].preview).toBeCloseTo(1, 1);
});
