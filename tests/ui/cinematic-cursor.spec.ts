import { expect, test } from "@playwright/test";

test("Cinematic's heavier glide matches preview and canvas export", async ({ page }) => {
	await page.route("**/cinematic-weight-audit.html", (route) =>
		route.fulfill({ contentType: "text/html", body: "<!doctype html><body></body>" }),
	);
	await page.goto("/cinematic-weight-audit.html");
	const trajectories = await page.evaluate(async () => {
		const renderer = await import(
			"/src/components/video-editor/videoPlayback/cursorRenderer.ts"
		);
		const { CURSOR_MOTION_PRESETS } = await import(
			"/src/components/video-editor/cursorMotionPresets.ts"
		);
		await renderer.preloadCursorAssets();
		const canvas = document.createElement("canvas");
		canvas.width = 800;
		canvas.height = 400;
		const viewport = { x: 0, y: 0, width: 800, height: 400 };
		const samples = [
			{ timeMs: 0, cx: 0.2, cy: 0.5 },
			{ timeMs: 100, cx: 0.8, cy: 0.5 },
			{ timeMs: 2000, cx: 0.8, cy: 0.5 },
		];
		const results = [];
		for (const preset of [CURSOR_MOTION_PRESETS.focused, CURSOR_MOTION_PRESETS.smooth]) {
			const config = {
				...renderer.DEFAULT_CURSOR_CONFIG,
				style: "dot",
				smoothingFactor: preset.cursorSmoothing,
				springTuning: {
					stiffnessMultiplier: preset.cursorSpringStiffnessMultiplier,
					dampingMultiplier: preset.cursorSpringDampingMultiplier,
					massMultiplier: preset.cursorSpringMassMultiplier,
				},
			};
			const overlay = new renderer.PixiCursorOverlay(config);
			const exported = new renderer.SmoothedCursorState(config);
			const frames = [];
			for (let frame = 0; frame <= 120; frame++) {
				const time = (frame * 1000) / 60;
				overlay.update(samples, time, viewport, true);
				renderer.drawCursorOnCanvas(
					canvas.getContext("2d")!,
					samples,
					time,
					viewport,
					exported,
					config,
				);
				frames.push({
					time,
					preview: overlay.getSmoothedCursorSnapshot()!.cx,
					exported: exported.x,
				});
			}
			results.push(frames);
			overlay.destroy();
		}
		return results;
	});
	for (const frames of trajectories)
		for (const frame of frames) expect(frame.preview).toBeCloseTo(frame.exported, 10);
	expect(trajectories[1][6].preview).toBeLessThan(trajectories[0][6].preview);
	expect(trajectories[1][120].preview).toBeCloseTo(0.8, 3);
});

test("Cinematic removes brief hover shapes in preview and canvas export without delaying sustained hovers", async ({
	page,
}) => {
	await page.route("**/cinematic-cursor-audit.html", (route) =>
		route.fulfill({ contentType: "text/html", body: "<!doctype html><body></body>" }),
	);
	await page.goto("/cinematic-cursor-audit.html");
	const frames = await page.evaluate(async () => {
		const renderer = await import(
			"/src/components/video-editor/videoPlayback/cursorRenderer.ts"
		);
		const { CURSOR_MOTION_PRESETS } = await import(
			"/src/components/video-editor/cursorMotionPresets.ts"
		);
		const { Application } = await import("/tests/ui/pixiAudit.ts");
		await renderer.preloadCursorAssets();
		const app = new Application();
		await app.init({ width: 400, height: 200, backgroundAlpha: 0, resolution: 1 });
		const preset = CURSOR_MOTION_PRESETS.smooth;
		const config = {
			...renderer.DEFAULT_CURSOR_CONFIG,
			style: "macos",
			dotRadius: 120,
			idleHide: { ...renderer.DEFAULT_CURSOR_CONFIG.idleHide, enabled: false },
			smoothingFactor: preset.cursorSmoothing,
			springTuning: {
				stiffnessMultiplier: preset.cursorSpringStiffnessMultiplier,
				dampingMultiplier: preset.cursorSpringDampingMultiplier,
				massMultiplier: preset.cursorSpringMassMultiplier,
			},
		};
		const overlay = new renderer.PixiCursorOverlay(config);
		app.stage.addChild(overlay.container);
		const canvas = document.createElement("canvas");
		canvas.width = 400;
		canvas.height = 200;
		const ctx = canvas.getContext("2d")!;
		const viewport = { x: 0, y: 0, width: 400, height: 200 };
		const fingerprint = (source: HTMLCanvasElement) => {
			ctx.clearRect(0, 0, 400, 200);
			ctx.drawImage(source, 0, 0);
			let hash = 2166136261;
			for (const byte of ctx.getImageData(0, 0, 400, 200).data)
				hash = Math.imul(hash ^ byte, 16777619);
			return hash;
		};
		const draw = (samples, time) => {
			overlay.update(samples, time, viewport, true, true);
			app.render();
			const preview = fingerprint(app.canvas);
			ctx.clearRect(0, 0, 400, 200);
			renderer.drawCursorOnCanvas(
				ctx,
				samples,
				time,
				viewport,
				new renderer.SmoothedCursorState(config),
				config,
			);
			let hash = 2166136261;
			for (const byte of ctx.getImageData(0, 0, 400, 200).data)
				hash = Math.imul(hash ^ byte, 16777619);
			return { preview, exported: hash };
		};
		const point = (timeMs, cursorType) => ({
			timeMs,
			cursorType,
			cx: 0.5,
			cy: 0.5,
			interactionType: "move",
		});
		const results = [];
		for (const [baseline, excursion] of [
			["arrow", "pointer"],
			["pointer", "arrow"],
		]) {
			const samples = [
				point(0, baseline),
				point(1000, excursion),
				point(1300, baseline),
				point(2000, excursion),
				point(3000, baseline),
				point(4000, baseline),
			];
			const reference = {
				[baseline]: draw([point(0, baseline), point(5000, baseline)], 0),
				[excursion]: draw([point(0, excursion), point(5000, excursion)], 0),
			};
			for (const time of [1000, 1150, 1299, 2000, 2250, 3000, 1100]) {
				const expected = time >= 2000 && time < 3000 ? excursion : baseline;
				results.push({
					baseline,
					time,
					actual: draw(samples, time),
					expected: reference[expected],
				});
			}
		}
		overlay.destroy();
		app.destroy(true);
		return results;
	});
	for (const backend of ["preview", "exported"] as const)
		expect(frames[0].expected[backend]).not.toBe(frames[7].expected[backend]);
	for (const frame of frames) expect(frame.actual, JSON.stringify(frame)).toEqual(frame.expected);
});
