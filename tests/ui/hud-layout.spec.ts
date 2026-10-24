import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";
import { resizeHudOverlayFallbackBounds } from "../../electron/hudOverlayBounds";

for (const { windowY, windowSystem } of [
	{ windowY: 120, windowSystem: "x11" },
	{ windowY: 700, windowSystem: "x11" },
	{ windowY: 120, windowSystem: "wayland" },
] as const) {
	test(`${windowSystem} HUD menus keep the bar stationary at window y=${windowY}`, async ({
		page,
	}) => {
		await page.setViewportSize({ width: 860, height: 160 });
		await installDesktopBridge(page);
		let nativeBounds = { x: 530, y: windowY, width: 860, height: 160 };
		let compactBounds = { ...nativeBounds };
		const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
		let menuOpens = 0;
		// Model the native compact/expanded window at the desktop bridge boundary.
		await page.exposeFunction("resizeTestHud", async (open: boolean) => {
			if (open) compactBounds = { ...nativeBounds };
			nativeBounds = resizeHudOverlayFallbackBounds(
				workArea,
				nativeBounds,
				open,
				compactBounds,
			);
			await page.evaluate(
				({ x, y }) => {
					Object.defineProperty(window, "screenX", { configurable: true, value: x });
					Object.defineProperty(window, "screenY", { configurable: true, value: y });
				},
				windowSystem === "wayland"
					? { x: 0, y: open && menuOpens++ > 0 ? 160 : 0 }
					: nativeBounds,
			);
			await page.setViewportSize({ width: nativeBounds.width, height: nativeBounds.height });
			if (windowSystem === "wayland" && !open && menuOpens > 0) {
				// Wayland can report a requested origin after resize despite no physical move.
				await page.evaluate(() =>
					Object.defineProperty(window, "screenY", { configurable: true, value: 540 }),
				);
			}
		});
		await page.addInitScript(
			({ x, y }) => {
				Object.defineProperty(window, "screenX", { configurable: true, value: x });
				Object.defineProperty(window, "screenY", { configurable: true, value: y });
			},
			windowSystem === "wayland" ? { x: 0, y: 0 } : nativeBounds,
		);
		await installDesktopBridgeOverrides(
			page,
			(windowSystem) => {
				Object.assign(window.electronAPI, {
					getPlatform: async () => "linux",
					getHudOverlayMousePassthroughSupported: async () => ({
						success: true,
						supported: false,
						windowSystem,
					}),
					hudOverlaySetMenuOpen: (open: boolean) =>
						(
							window as unknown as { resizeTestHud: (open: boolean) => Promise<void> }
						).resizeTestHud(open),
				});
				navigator.mediaDevices.enumerateDevices = async () => [
					{
						deviceId: "test-mic",
						kind: "audioinput",
						label: "Test microphone",
						groupId: "test",
						toJSON: () => ({}),
					},
					{
						deviceId: "test-camera",
						kind: "videoinput",
						label: "Test camera",
						groupId: "test",
						toJSON: () => ({}),
					},
				];
			},
			windowSystem,
		);
		await page.goto("/?windowType=hud-overlay");
		const bar = page
			.getByRole("button", { name: "Choose recording source" })
			.locator("..")
			.locator("..");
		await expect(bar).toBeVisible();
		const screenPosition = () =>
			bar.evaluate(
				(element, { windowSystem, windowY }) => {
					const bounds = element.getBoundingClientRect();
					return {
						x: Math.round(
							(windowSystem === "wayland" ? 530 : window.screenX) + bounds.x,
						),
						y: Math.round(
							(windowSystem === "wayland" ? windowY : window.screenY) + bounds.y,
						),
					};
				},
				{ windowSystem, windowY },
			);
		// Let the initial HUD entrance finish before capturing its desktop position.
		await expect(page.getByRole("button", { name: "Choose recording source" })).toBeEnabled();
		await expect(
			page.getByRole("button", { name: "Choose recording source" }).locator(".."),
		).toHaveCSS("opacity", "1");
		const original = await screenPosition();
		for (const name of ["Enable microphone", "Enable webcam overlay", "Countdown delay"]) {
			await page.getByRole("button", { name, exact: true }).click();
			const menu = page.getByRole("dialog", { name: "Options", exact: true });
			await expect(menu).toBeInViewport({ ratio: 1 });
			await expect.poll(() => page.evaluate(() => window.innerHeight)).toBe(540);
			await expect.poll(screenPosition).toEqual(original);
			await expect(menu.getByRole("button").first()).toBeInViewport({ ratio: 1 });
			await expect(menu.getByRole("button").last()).toBeInViewport({ ratio: 1 });
			await page.keyboard.press("Escape");
			await expect(menu).toHaveCount(0);
			await expect.poll(() => page.evaluate(() => window.innerHeight)).toBe(160);
			await expect.poll(screenPosition).toEqual(original);
		}
		await page.getByRole("button", { name: "Countdown delay", exact: true }).click();
		await expect.poll(() => page.evaluate(() => window.innerHeight)).toBe(540);
		await page.evaluate(() => window.dispatchEvent(new Event("blur")));
		await expect(page.getByRole("dialog", { name: "Options", exact: true })).toHaveCount(0);
		await expect.poll(() => page.evaluate(() => window.innerHeight)).toBe(160);
		await expect.poll(screenPosition).toEqual(original);
	});
}

test("Wayland keeps the bar stationary when a menu closes before native resizes arrive", async ({
	page,
}) => {
	await page.setViewportSize({ width: 860, height: 160 });
	await installDesktopBridge(page);
	const requests: boolean[] = [];
	let opened = false;
	await page.exposeFunction("queueHudResize", (open: boolean) => {
		if (open) opened = true;
		if (opened) requests.push(open);
	});
	await installDesktopBridgeOverrides(page, () => {
		Object.assign(window.electronAPI, {
			getPlatform: async () => "linux",
			getHudOverlayMousePassthroughSupported: async () => ({
				success: true,
				supported: false,
				windowSystem: "wayland",
			}),
			hudOverlaySetMenuOpen: (open: boolean) =>
				(window as unknown as { queueHudResize: (open: boolean) => void }).queueHudResize(
					open,
				),
		});
	});
	await page.goto("/?windowType=hud-overlay");
	const source = page.getByRole("button", { name: "Choose recording source" });
	await expect(source).toBeEnabled();
	await expect(source.locator("..")).toHaveCSS("opacity", "1");
	const barTop = () =>
		source.locator("..").evaluate((element) => Math.round(element.getBoundingClientRect().top));
	const original = await barTop();
	await page.getByRole("button", { name: "Countdown delay", exact: true }).click();
	await expect.poll(() => requests).toEqual([true]);
	await page.keyboard.press("Escape");
	await expect.poll(() => requests).toEqual([true, false]);
	await page.setViewportSize({ width: 860, height: 540 });
	await expect.poll(barTop).toBe(original);
	await page.setViewportSize({ width: 860, height: 160 });
	await expect.poll(barTop).toBe(original);
});

test("X11 reanchors after a coalesced menu resize and native dragging", async ({ page }) => {
	await page.setViewportSize({ width: 860, height: 160 });
	await installDesktopBridge(page);
	const requests: boolean[] = [];
	let opened = false;
	await page.exposeFunction("queueHudResize", (open: boolean) => {
		if (open) opened = true;
		if (opened) requests.push(open);
	});
	await installDesktopBridgeOverrides(page, () => {
		Object.defineProperty(window, "screenX", { configurable: true, value: 530 });
		Object.defineProperty(window, "screenY", { configurable: true, value: 120 });
		Object.assign(window.electronAPI, {
			getPlatform: async () => "linux",
			getHudOverlayMousePassthroughSupported: async () => ({
				success: true,
				supported: false,
				windowSystem: "x11",
			}),
			hudOverlaySetMenuOpen: (open: boolean) =>
				(window as unknown as { queueHudResize: (open: boolean) => void }).queueHudResize(
					open,
				),
		});
	});
	await page.goto("/?windowType=hud-overlay");
	const source = page.getByRole("button", { name: "Choose recording source" });
	await expect(source).toBeEnabled();
	await expect(source.locator("..")).toHaveCSS("opacity", "1");
	const screenTop = () =>
		source
			.locator("..")
			.evaluate((element) =>
				Math.round(window.screenY + element.getBoundingClientRect().top),
			);
	const countdown = page.getByRole("button", { name: "Countdown delay", exact: true });
	await countdown.click();
	await expect.poll(() => requests).toEqual([true]);
	await page.keyboard.press("Escape");
	await expect.poll(() => requests).toEqual([true, false]);
	// The OS coalesces both sizes into the original compact viewport; then the user drags.
	await page.evaluate(() =>
		Object.defineProperty(window, "screenY", { configurable: true, value: 420 }),
	);
	const draggedTop = await screenTop();
	await countdown.click();
	await expect.poll(() => requests).toEqual([true, false, true]);
	await page.evaluate(() =>
		Object.defineProperty(window, "screenY", { configurable: true, value: 40 }),
	);
	await page.setViewportSize({ width: 860, height: 540 });
	await expect.poll(screenTop).toBe(draggedTop);
});

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

test("HUD dividers are vertically centered", async ({ page }) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=hud-overlay");
	const dividers = page.locator(".separator--vertical");
	await expect(dividers.first()).toBeVisible();
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
	await home.click();
	await expect(page.locator("html")).toHaveAttribute("data-dashboard-opened", "true");
	await page.goto("/?windowType=editor");
	await expect(page.getByRole("dialog", { name: "Projects dashboard" })).toBeVisible({
		timeout: 15000,
	});
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
	await expect(page.locator(".separator--vertical").first()).toBeVisible();
	await page.evaluate(() => window.dispatchEvent(new Event("test-recording-started")));
	const controls = page.getByRole("group", { name: "Recording controls" });
	await expect(controls).toBeVisible();
	await expect(controls.getByRole("status")).toContainText("00:00");
	await expect(controls.getByRole("button", { name: "Home", exact: true })).toBeVisible();
	const sizes = await controls.getByRole("button").evaluateAll((buttons) =>
		buttons.map((button) => {
			return [(button as HTMLElement).offsetWidth, (button as HTMLElement).offsetHeight];
		}),
	);
	for (const size of sizes) expect(size).toEqual([36, 36]);
	await page.screenshot({ path: "test-results/hud-recording.png" });
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

for (const storageBlocked of [false, true]) {
	test(`floating webcam preview resizes from its corners ${storageBlocked ? "when storage is unavailable" : "and remembers the size"}`, async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await installDesktopBridge(page);
		if (storageBlocked) {
			await page.addInitScript(() => {
				const getItem = Storage.prototype.getItem;
				const setItem = Storage.prototype.setItem;
				Storage.prototype.getItem = function (key) {
					if (key === "recordly.webcam-preview-size")
						throw new Error("Storage unavailable");
					return getItem.call(this, key);
				};
				Storage.prototype.setItem = function (key, value) {
					if (key === "recordly.webcam-preview-size")
						throw new Error("Storage unavailable");
					return setItem.call(this, key, value);
				};
			});
		}
		await page.addInitScript(() => {
			window.electronAPI.hudOverlaySetIgnoreMouse = async (ignore) => {
				document.documentElement.dataset.webcamPassthrough = String(ignore);
				return { success: true };
			};
			window.electronAPI.getRecordingPreferences = async () => ({
				success: true,
				microphoneEnabled: false,
				webcamEnabled: true,
				systemAudioEnabled: false,
			});
			navigator.mediaDevices.getUserMedia = async () => {
				const canvas = document.createElement("canvas");
				canvas.getContext("2d")!.fillRect(0, 0, 320, 320);
				return canvas.captureStream(24);
			};
			navigator.mediaDevices.enumerateDevices = async () => [];
		});
		await page.goto("/?windowType=hud-overlay");
		const preview = page.locator("[data-resize-handle]").first().locator("..");
		await expect(preview).toBeVisible();
		const before = (await preview.boundingBox())!;
		expect([before.width, before.height]).toEqual([288, 288]);

		const dragHandle = async (handle: string, dx: number, dy: number) => {
			const box = (await preview.locator(`[data-resize-handle="${handle}"]`).boundingBox())!;
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
			await page.mouse.down();
			await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, {
				steps: 5,
			});
			await page.mouse.up();
		};

		// Top-left grows the preview while the bottom-right corner stays anchored.
		await dragHandle("nw", -60, -40);
		const grown = (await preview.boundingBox())!;
		expect([grown.width, grown.height]).toEqual([348, 328]);
		expect(grown.x + grown.width).toBeCloseTo(before.x + before.width);
		expect(grown.y + grown.height).toBeCloseTo(before.y + before.height);

		// Bottom-right shrinks the preview while the top-left corner stays put, down to the minimum.
		await dragHandle("se", -500, -500);
		const shrunk = (await preview.boundingBox())!;
		expect([shrunk.width, shrunk.height]).toEqual([120, 120]);
		expect(shrunk.x).toBeCloseTo(grown.x);
		expect(shrunk.y).toBeCloseTo(grown.y);
		await expect(page.locator("html")).toHaveAttribute("data-webcam-passthrough", "true");

		await page.reload();
		await expect(preview).toBeVisible();
		const restored = (await preview.boundingBox())!;
		expect([restored.width, restored.height]).toEqual(storageBlocked ? [288, 288] : [120, 120]);
		expect(errors).toEqual([]);
	});
}
