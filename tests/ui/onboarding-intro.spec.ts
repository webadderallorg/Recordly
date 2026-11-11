import { expect, test } from "@playwright/test";

test.use({
	launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
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
		const brand = page.locator(".onboarding-intro-brand");
		const logo = page.locator(".onboarding-intro-logo");
		const wordmark = brand.getByText("Recordly", { exact: true });
		await expect(logo).toHaveAttribute("data-mode", mode);
		await expect(brand).toHaveAttribute("data-presentation", "mark");
		await expect(wordmark).toHaveCSS("opacity", "0");
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
		await expect(brand).toHaveAttribute("data-presentation", "wordmark");
		await expect(wordmark).toHaveCSS("opacity", "1");
		expect(await logoCenter()).toBeLessThan(screenCenter - 50);
		const logoBounds = (await logo.boundingBox())!;
		const wordmarkBounds = (await wordmark.boundingBox())!;
		expect(wordmarkBounds.x).toBeGreaterThan(logoBounds.x + logoBounds.width);
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
		await expect(brand).toHaveAttribute("data-presentation", "releasing");
		await expect(html).toHaveAttribute("data-intro-stages", "ready,finished");
		await expect(brand).toHaveCSS("opacity", "0");
	});
}
