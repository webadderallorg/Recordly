import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

for (const reducedMotion of ["reduce", "no-preference"] as const) {
	test(`HUD source label respects ${reducedMotion} motion preference on hover`, async ({
		page,
	}) => {
		await page.emulateMedia({ reducedMotion });
		await installDesktopBridge(page);
		await page.addInitScript(() => {
			window.electronAPI.getSelectedSource = async () => ({
				id: "window:101:0",
				name: "A very long document title that overflows the recording source control",
			});
		});
		await page.goto("/?windowType=hud-overlay");
		const source = page.getByRole("button", { name: "Choose recording source", exact: true });
		const label = source.locator(".source-selector-marquee");
		await expect(label).toHaveAttribute("data-overflowing", "true");
		await source.hover();
		const reduce = reducedMotion === "reduce";
		await expect(label.locator(".source-selector-marquee-static")).toHaveCSS(
			"opacity",
			reduce ? "1" : "0",
		);
		await expect(label.locator(".source-selector-marquee-animated")).toHaveCSS(
			"opacity",
			reduce ? "0" : "1",
		);
		const track = label.locator(".source-selector-marquee-track");
		await expect(track).toHaveCSS(
			"animation-name",
			reduce ? "none" : "source-selector-marquee",
		);
		if (!reduce) await expect(track).toHaveCSS("animation-play-state", "running");
	});
}

test("HUD ready state uses a fixed grid with visible Home and minimise controls", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=hud-overlay");
	const dividers = page.locator(".separator--vertical");
	await expect(dividers).toHaveCount(0);
	const offsets = await dividers.evaluateAll((elements) =>
		elements.map((element) => {
			const bounds = element.getBoundingClientRect();
			const parent = element.parentElement!.getBoundingClientRect();
			return Math.abs(bounds.y + bounds.height / 2 - parent.y - parent.height / 2);
		}),
	);
	for (const offset of offsets) expect(offset).toBeLessThanOrEqual(1);
	const home = page.getByRole("button", { name: "Home", exact: true });
	await expect(home.locator("svg")).toHaveAttribute("data-icon-style", "bold");
	await expect(page.getByRole("button", { name: "More", exact: true })).toHaveCount(0);
	await expect
		.poll(() =>
			home.locator("svg").evaluate((element) => ({
				width: Math.round(element.getBoundingClientRect().width),
				height: Math.round(element.getBoundingClientRect().height),
			})),
		)
		.toEqual({ width: 20, height: 20 });
	await page.screenshot({ path: "test-results/hud-idle.png", animations: "disabled" });
	await page
		.locator('[data-recording-state="idle"]')
		.screenshot({ path: "test-results/hud-ready-detail.png" });
	await home.click();
	await expect(page.locator("html")).toHaveAttribute("data-dashboard-opened", "true");
	await page.goto("/?windowType=editor");
	await expect(page.getByRole("dialog", { name: "Projects dashboard" })).toBeVisible();
});

test("recording HUD uses uniform controls and a readable timer", async ({ page }) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		window.electronAPI.onRecordingStateChanged = (callback) => {
			const listener = () => callback({ recording: true, sourceName: "Built-in Display" });
			window.addEventListener("test-recording-started", listener);
			return () => window.removeEventListener("test-recording-started", listener);
		};
	});
	await page.goto("/?windowType=hud-overlay");
	const setup = page.getByRole("group", { name: "Recording setup", exact: true });
	await expect(setup).toBeVisible();
	const bar = page.locator('[data-recording-state="idle"]');
	const readyBounds = await bar.boundingBox();
	await page.evaluate(() => window.dispatchEvent(new Event("test-recording-started")));
	const controls = page.getByRole("group", { name: "Recording controls" });
	await expect(controls).toBeVisible();
	await expect
		.poll(() =>
			page
				.locator('[data-recording-state="recording"]')
				.evaluate(
					(node) =>
						node
							.getAnimations({ subtree: true })
							.filter((animation) => animation.playState === "running").length,
				),
		)
		.toBe(0);
	await expect(controls.getByRole("timer")).toContainText("0:00");
	await expect(controls.getByRole("button", { name: "Home", exact: true })).toHaveCount(0);
	await expect(controls.getByText("REC", { exact: true })).toHaveCount(0);
	expect(
		(await page.locator('[data-recording-state="recording"]').boundingBox())!.width,
	).toBeLessThan(readyBounds!.width);
	const sizes = await controls
		.getByRole("button")
		.filter({ hasNot: page.getByRole("timer") })
		.evaluateAll((buttons) =>
			buttons.map((button) => {
				return [(button as HTMLElement).offsetWidth, (button as HTMLElement).offsetHeight];
			}),
		);
	for (const size of sizes) expect(size).toEqual([36, 36]);
	await page.screenshot({ path: "test-results/hud-recording.png" });
	await page
		.locator('[data-recording-state="recording"]')
		.screenshot({ path: "test-results/hud-recording-detail.png" });
});

test("New recording mode starts the webcam with an editor still open and releases it on Home", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		window.electronAPI.getEditorMode = async () => true;
		window.electronAPI.onEditorModeChanged = (callback) => {
			const listener = (event: Event) => callback((event as CustomEvent<boolean>).detail);
			window.addEventListener("test-editor-mode", listener);
			return () => window.removeEventListener("test-editor-mode", listener);
		};
		window.electronAPI.getRecordingPreferences = async () => ({
			success: true,
			microphoneEnabled: false,
			webcamEnabled: true,
			systemAudioEnabled: false,
		});
		navigator.mediaDevices.getUserMedia = async () => {
			const canvas = document.createElement("canvas");
			canvas.width = 320;
			canvas.height = 320;
			const context = canvas.getContext("2d")!;
			context.fillStyle = "#2874ff";
			context.fillRect(0, 0, 320, 320);
			const stream = canvas.captureStream(24);
			setInterval(() => context.fillRect(0, 0, 320, 320), 100);
			return stream;
		};
		navigator.mediaDevices.enumerateDevices = async () => [];
	});
	await page.goto("/?windowType=hud-overlay");
	const preview = page.locator("video").first();
	await expect(preview).toBeVisible();
	await expect
		.poll(() => preview.evaluate((video: HTMLVideoElement) => video.srcObject === null))
		.toBe(true);
	await page.evaluate(() =>
		window.dispatchEvent(new CustomEvent("test-editor-mode", { detail: false })),
	);
	await expect
		.poll(() =>
			preview.evaluate(
				(video: HTMLVideoElement) =>
					!!video.srcObject && !video.paused && video.videoWidth === 320,
			),
		)
		.toBe(true);
	await page.evaluate(() =>
		window.dispatchEvent(new CustomEvent("test-editor-mode", { detail: true })),
	);
	await expect
		.poll(() => preview.evaluate((video: HTMLVideoElement) => video.srcObject === null))
		.toBe(true);
});

test("floating webcam preview ignores a legacy saved resize preference", async ({ page }) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		localStorage.setItem(
			"recordly.webcam-preview-size",
			JSON.stringify({ width: 480, height: 320 }),
		);
		window.electronAPI.getRecordingPreferences = async () => ({
			success: true,
			microphoneEnabled: false,
			webcamEnabled: true,
			systemAudioEnabled: false,
		});
	});
	await page.goto("/?windowType=hud-overlay");
	const preview = page.locator("[data-floating-webcam-preview]");
	await expect(preview).toBeVisible();
	const bounds = (await preview.boundingBox())!;
	expect([bounds.width, bounds.height]).toEqual([230, 230]);
	await expect(preview.locator("[data-resize-handle]")).toHaveCount(0);
	await expect(preview.locator("video")).toHaveCSS("clip-path", "circle(50%)");
});
