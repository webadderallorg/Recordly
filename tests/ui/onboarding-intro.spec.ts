import { expect, test } from "@playwright/test";

test.use({
	launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
});

test("Windows and Linux OS icons use a solid rounded plate like macOS", async ({ page }) => {
	await page.goto("/?windowType=onboarding-intro");
	for (const url of [
		"/icons/icons/png/512x512.png",
		"/icons/icons/png/16x16.png",
		"/app-icons/recordly-512.png",
		"/app-icons/recordly-16.png",
	]) {
		const plate = await page.evaluate(async (url) => {
			const image = new Image();
			image.src = url;
			await image.decode();
			const canvas = new OffscreenCanvas(image.width, image.height);
			const context = canvas.getContext("2d")!;
			context.drawImage(image, 0, 0);
			const sample = (y: number) => [
				...context.getImageData(image.width / 2, Math.floor(image.height * y), 1, 1).data,
			];
			const corner = [...context.getImageData(0, 0, 1, 1).data];
			return { top: sample(0.15), bottom: sample(0.85), corner };
		}, url);
		// Solid fill, not a gradient; allow resampling noise at 16px.
		for (const [i, channel] of plate.top.entries()) {
			expect(Math.abs(channel - plate.bottom[i]), url).toBeLessThanOrEqual(4);
		}
		expect(plate.corner[3], url).toBe(0);
		expect(plate.top[2], url).toBeGreaterThan(plate.top[0] + 200);
	}
});

for (const mode of ["glass", "fallback", "reduced motion"] as const) {
	test(`onboarding intro hands off in ${mode} mode`, async ({ page }) => {
		if (mode === "reduced motion") await page.emulateMedia({ reducedMotion: "reduce" });
		await page.addInitScript((mode) => {
			const stages: string[] = [];
			Object.defineProperty(window, "electronAPI", {
				value: {
					reportOnboardingIntro: (stage: string) => {
						stages.push(stage);
						document.documentElement.dataset.introStages = stages.join(",");
					},
				},
			});
			{
				const getContext = HTMLCanvasElement.prototype.getContext;
				HTMLCanvasElement.prototype.getContext = function (
					this: HTMLCanvasElement,
					type: string,
					...args: unknown[]
				) {
					if (type !== "webgl2") return Reflect.apply(getContext, this, [type, ...args]);
					if (mode === "fallback") return null;
					return Reflect.apply(getContext, this, [
						type,
						{ ...(args[0] as WebGLContextAttributes), preserveDrawingBuffer: true },
					]);
				} as typeof getContext;
			}
		}, mode);
		await page.goto("/?windowType=onboarding-intro");

		const html = page.locator("html");
		// The intro is part of the brand, so it plays even with reduced motion on.
		const expectedMode = mode === "fallback" ? "fallback" : "glass";
		await expect(html).toHaveAttribute("data-intro-stages", "ready");
		const intro = page.locator(".onboarding-intro");
		const logo = page.locator(".onboarding-intro-logo");
		await expect(logo).toHaveAttribute("data-mode", expectedMode);
		await expect(intro).toHaveText("");
		if (mode === "fallback") {
			await expect(logo.locator("img")).toHaveAttribute("src", /recordlymac-512\.png$/);
		}
		const logoCenter = () =>
			logo.evaluate((el) => {
				const bounds = el.getBoundingClientRect();
				return bounds.x + bounds.width / 2;
			});
		const screenCenter = page.viewportSize()!.width / 2;
		expect(await logoCenter()).toBeCloseTo(screenCenter, 0);
		await expect(html).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
		await expect(page.locator("body")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
		await expect(logo).toHaveAttribute("data-phase", "holding");
		await expect(intro).toHaveText("");
		await expect(logo).toHaveCSS("opacity", "1");
		expect(await logoCenter()).toBeCloseTo(screenCenter, 0);
		if (expectedMode === "glass") {
			const showsDesktopIcon = await logo
				.locator("canvas")
				.evaluate((canvas: HTMLCanvasElement) => {
					const gl = canvas.getContext("webgl2");
					if (!gl) return false;
					const sample = (x: number) => {
						const color = new Uint8Array(4);
						gl.readPixels(
							Math.floor(canvas.width * x),
							Math.floor(canvas.height / 2),
							1,
							1,
							gl.RGBA,
							gl.UNSIGNED_BYTE,
							color,
						);
						return color;
					};
					const [markRed, markGreen, markBlue, markAlpha] = sample(0.5);
					const [plateRed, , plateBlue, plateAlpha] = sample(0.61);
					return (
						markAlpha > 240 &&
						Math.min(markRed, markGreen, markBlue) > 190 &&
						plateAlpha > 240 &&
						plateBlue > plateRed + 80 &&
						sample(0.69)[3] < 10
					);
				});
			expect(showsDesktopIcon).toBe(true);
		}
		await expect(logo).toHaveAttribute("data-phase", "releasing");
		await expect(html).toHaveAttribute("data-intro-stages", "ready,finished");
		await expect(logo).toHaveCSS("opacity", "0");
	});
}
