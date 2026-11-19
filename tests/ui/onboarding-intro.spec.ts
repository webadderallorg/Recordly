import { expect, test } from "@playwright/test";

test.use({
	launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
});

test("Windows and Linux OS icons use a flat plate like macOS", async ({ page }) => {
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
			return { top: sample(0.08), bottom: sample(0.92) };
		}, url);
		expect(plate.top, url).toEqual(plate.bottom);
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
			if (mode !== "reduced motion") {
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
		if (mode === "reduced motion") {
			await expect(html).toHaveAttribute("data-intro-stages", "skipped");
			await expect(page.locator(".onboarding-intro")).toBeHidden();
			return;
		}

		await expect(html).toHaveAttribute("data-intro-stages", "ready");
		const intro = page.locator(".onboarding-intro");
		const brand = intro.locator(".onboarding-intro-brand");
		const logo = page.locator(".onboarding-intro-logo");
		await expect(logo).toHaveAttribute("data-mode", mode);
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
		await expect(page.locator(".onboarding-intro-backdrop")).toHaveCSS("position", "absolute");
		await expect(brand).toHaveAttribute("data-releasing", "true");
		await expect(intro).toHaveText("");
		expect(await logoCenter()).toBeCloseTo(screenCenter, 0);
		if (mode === "glass") {
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
		await expect(html).toHaveAttribute("data-intro-stages", "ready,finished");
		await expect(brand).toHaveCSS("opacity", "0");
	});
}
