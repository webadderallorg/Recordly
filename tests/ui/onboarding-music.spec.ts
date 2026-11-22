import { expect } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";
import { productionTest as test } from "./production";

test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } });

for (const standalone of [false, true]) {
	test(`onboarding plays the soundtrack from the MP4 (${standalone ? "window" : "inline fallback"})`, async ({
		page,
	}) => {
		await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: standalone });
		await page.goto(`/?windowType=${standalone ? "onboarding" : "editor"}`);
		const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
		await expect(
			tour.getByRole("button", { name: "Mute welcome music", exact: true }),
		).toBeVisible({
			timeout: 20000,
		});
		const audio = tour.locator("audio");
		await expect(audio).toHaveAttribute("src", /auth\/recordly-soundtrack\.mp4/);
		const banner = tour.locator("[data-recordly-demo] video");
		// The soundtrack outlasts the looping banner instead of being cut to its length.
		await expect
			.poll(async () => {
				const [song, clip] = await Promise.all([
					audio.evaluate((el: HTMLAudioElement) => el.duration),
					banner.evaluate((el: HTMLVideoElement) => el.duration),
				]);
				return song > clip * 5;
			})
			.toBe(true);
		await expect
			.poll(() => audio.evaluate((el) => Reflect.get(el, "webkitAudioDecodedByteCount")))
			.toBeGreaterThan(0);
		await expect(banner).toHaveJSProperty("muted", true);
	});
}

test("soundtrack starts at the logo and the banner waits for the onboarding window", async ({
	page,
}) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
	await installDesktopBridgeOverrides(page, () => {
		const decode = HTMLImageElement.prototype.decode;
		HTMLImageElement.prototype.decode = function () {
			if (this.classList.contains("recordly-banner-dark"))
				return new Promise(() => undefined);
			return decode.call(this);
		};
		window.electronAPI.onOnboardingSoundtrackStart = (callback) => {
			document.documentElement.dataset.soundtrackReady = "true";
			window.addEventListener("test-logo-start", callback);
			return () => window.removeEventListener("test-logo-start", callback);
		};
		window.electronAPI.waitForOnboardingBanner = () =>
			new Promise<void>((resolve) => {
				document.documentElement.dataset.bannerReady = "true";
				window.addEventListener("test-banner-start", () => resolve(), { once: true });
			});
	});
	await page.goto("/?windowType=onboarding&welcomeSoundtrack=intro");
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	const banner = tour.locator("[data-recordly-demo]");
	const audio = tour.locator("audio");
	await expect(page.locator("html")).toHaveAttribute("data-soundtrack-ready", "true");
	await expect(audio).toHaveJSProperty("paused", true);
	await expect(audio).toHaveJSProperty("currentTime", 0);
	await expect(page.locator("html")).toHaveAttribute("data-banner-ready", "true");
	await page.evaluate(() => window.dispatchEvent(new Event("test-logo-start")));
	await expect(audio).toHaveJSProperty("paused", false);
	await expect
		.poll(() => audio.evaluate((el: HTMLAudioElement) => el.currentTime))
		.toBeGreaterThan(1);
	const video = banner.locator("video");
	await expect(banner).toHaveAttribute("data-banner-phase", "loading");
	await expect(video).toHaveJSProperty("currentTime", 0);

	await page.evaluate(() => window.dispatchEvent(new Event("test-banner-start")));
	await expect(banner).toHaveAttribute("data-banner-phase", "still");
	await expect(video).toHaveJSProperty("currentTime", 0);
	await expect(banner).toHaveAttribute("data-banner-phase", "video");
	await expect(video).toHaveJSProperty("muted", true);
});

test("soundtrack loops after the full track ends", async ({ page }) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
	await page.goto("/?windowType=onboarding");
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	const audio = tour.locator("audio");
	await expect(
		tour.getByRole("button", { name: "Mute welcome music", exact: true }),
	).toBeVisible();
	await expect(audio).toHaveJSProperty("loop", true);
	await expect(audio).toHaveJSProperty("volume", 1, { timeout: 4000 });
	await audio.evaluate((el: HTMLAudioElement) => {
		el.currentTime = el.duration - 1;
	});
	await expect
		.poll(() => audio.evaluate((el: HTMLAudioElement) => el.currentTime), { timeout: 5000 })
		.toBeLessThan(1);
	await expect(audio).toHaveJSProperty("paused", false);
	await expect(audio).toHaveJSProperty("volume", 1);
	await expect(tour.locator("[data-welcome-music]")).toBeVisible();
});

test("soundtrack fades in over two seconds from silence", async ({ page }) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.onOnboardingSoundtrackStart = (callback) => {
			document.documentElement.dataset.soundtrackReady = "true";
			window.addEventListener("test-logo-start", callback);
			return () => window.removeEventListener("test-logo-start", callback);
		};
	});
	await page.goto("/?windowType=onboarding&welcomeSoundtrack=intro");
	const audio = page.getByRole("dialog", { name: "Welcome to Recordly" }).locator("audio");
	await expect(page.locator("html")).toHaveAttribute("data-soundtrack-ready", "true");
	// Start playback and read the volume in the page, so runner delays cannot advance the fade.
	const initialVolume = await audio.evaluate(async (el: HTMLAudioElement) => {
		const playing = new Promise((resolve) =>
			el.addEventListener("playing", resolve, { once: true }),
		);
		window.dispatchEvent(new Event("test-logo-start"));
		await playing;
		return el.volume;
	});
	expect(initialVolume).toBeLessThan(0.6);
	await expect(audio).toHaveJSProperty("volume", 1, { timeout: 4000 });
});

test("blocked autoplay retries on interaction and the sound control does not pause playback", async ({
	page,
}) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
	await installDesktopBridgeOverrides(page, () => {
		const play = HTMLMediaElement.prototype.play;
		let blocked = false;
		HTMLMediaElement.prototype.play = async function () {
			if (!blocked && this instanceof HTMLAudioElement) {
				blocked = true;
				throw new DOMException("Interaction required", "NotAllowedError");
			}
			return play.call(this);
		};
	});
	await page.goto("/?windowType=onboarding");
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	const audio = tour.locator("audio");
	const unmute = tour.getByRole("button", { name: "Unmute welcome music", exact: true });
	const mute = tour.getByRole("button", { name: "Mute welcome music", exact: true });
	const email = tour.getByPlaceholder("you@example.com");
	await expect(unmute).toBeVisible();
	await expect(audio).toHaveJSProperty("paused", true);
	await email.click();
	await expect(mute).toBeVisible();
	await mute.click();
	await email.click();
	await expect(audio).toHaveJSProperty("muted", true);
	await expect(audio).toHaveJSProperty("paused", false);
	await unmute.click();
	await expect(audio).toHaveJSProperty("muted", false);
});

test("recording stops the soundtrack and a new onboarding opening restarts it", async ({
	page,
}) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: true });
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.onRecordingStateChanged = (callback) => {
			const recordingStarted = () => callback({ recording: true, sourceName: "Test source" });
			window.addEventListener("test-recording-started", recordingStarted);
			return () => window.removeEventListener("test-recording-started", recordingStarted);
		};
	});
	await page.goto("/?windowType=onboarding");
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	const audio = tour.locator("audio");
	const mute = tour.getByRole("button", { name: "Mute welcome music", exact: true });
	await expect(mute).toBeVisible();
	await page.evaluate(() => window.dispatchEvent(new Event("test-recording-started")));
	await expect(audio).toHaveJSProperty("paused", true);
	await expect(tour.locator("[data-welcome-music]")).toHaveCount(0);
	await tour.getByRole("button", { name: "Close onboarding window" }).click();
	await expect(tour).not.toBeVisible();
	// Closing destroys the onboarding window, so the next opening is a fresh load.
	await page.reload();
	await expect(mute).toBeVisible();
	await expect(audio).toHaveJSProperty("paused", false);
});
