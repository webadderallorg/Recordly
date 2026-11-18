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
		await expect(audio).toHaveAttribute("src", /auth\/recordly-demo\.mp4/);
		await expect
			.poll(() => audio.evaluate((el) => Reflect.get(el, "webkitAudioDecodedByteCount")))
			.toBeGreaterThan(0);
		await expect(tour.locator("[data-recordly-demo] video")).toHaveJSProperty("muted", true);
	});
}

test("soundtrack begins on the logo signal and continues while the banner starts", async ({
	page,
}) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.onOnboardingSoundtrackStart = (callback) => {
			document.documentElement.dataset.soundtrackReady = "true";
			window.addEventListener("test-logo-start", callback);
			return () => window.removeEventListener("test-logo-start", callback);
		};
	});
	await page.goto("/?windowType=onboarding&welcomeSoundtrack=intro");
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	const banner = tour.locator("[data-recordly-demo]");
	const audio = tour.locator("audio");
	await expect(page.locator("html")).toHaveAttribute("data-soundtrack-ready", "true");
	await expect(audio).toHaveJSProperty("paused", true);
	await expect(audio).toHaveJSProperty("currentTime", 0);
	await page.evaluate(() => window.dispatchEvent(new Event("test-logo-start")));
	await expect(audio).toHaveJSProperty("paused", false);
	await expect(banner).toHaveAttribute("data-banner-phase", "video");
	await expect
		.poll(() => audio.evaluate((el: HTMLAudioElement) => el.currentTime))
		.toBeGreaterThan(1);
	await expect(banner.locator("video")).toHaveJSProperty("muted", true);
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
		window.electronAPI.onRecordingPermissionsRequested = (callback) => {
			window.addEventListener("test-open-onboarding", callback);
			return () => window.removeEventListener("test-open-onboarding", callback);
		};
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
	await page.evaluate(() => window.dispatchEvent(new Event("test-open-onboarding")));
	await expect(mute).toBeVisible();
	await expect(audio).toHaveJSProperty("paused", false);
});
