import { expect } from "@playwright/test";
import { productionTest as test } from "./production";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

for (const standalone of [false, true]) {
	test(`actual onboarding plays music despite previous playback (${standalone ? "window" : "inline fallback"})`, async ({
		page,
	}) => {
		await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: standalone });
		await installDesktopBridgeOverrides(page, () => {
			const getSetting = window.electronAPI.getAppSetting;
			localStorage.setItem("recordly.first-boot-music.v1.played", "true");
			window.electronAPI.getAppSetting = (key) =>
				key === "recordly.first-boot-music.v1.played" ? true : getSetting(key);
			HTMLMediaElement.prototype.play = async function () {
				if (this instanceof HTMLAudioElement) {
					document.documentElement.dataset.welcomeMusic = this.src;
					document.documentElement.dataset.musicAttempts = String(
						Number(document.documentElement.dataset.musicAttempts || 0) + 1,
					);
				}
			};
		});
		await page.goto(`/?windowType=${standalone ? "onboarding" : "editor"}`);
		const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
		await expect(tour.getByRole("button", { name: "Mute welcome music" })).toBeVisible({
			timeout: 30000,
		});
		await expect(page.locator("html")).toHaveAttribute(
			"data-welcome-music",
			/audio\/first-boot.m4a$/,
		);
		await expect(page.locator("html")).toHaveAttribute("data-music-attempts", "1");
		await expect(tour.locator("[data-recordly-demo]")).toBeVisible();
	});
}

test("actual onboarding restarts music when reopened in the same window", async ({ page }) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: true });
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.onRecordingPermissionsRequested = (callback) => {
			window.addEventListener("test-open-onboarding", callback);
			return () => window.removeEventListener("test-open-onboarding", callback);
		};
		HTMLMediaElement.prototype.play = async function () {
			if (this instanceof HTMLAudioElement) {
				document.documentElement.dataset.musicStartTime = String(this.currentTime);
				this.currentTime = 12;
				document.documentElement.dataset.musicAttempts = String(
					Number(document.documentElement.dataset.musicAttempts || 0) + 1,
				);
			}
		};
	});
	await page.goto("/?windowType=onboarding");
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await expect(tour.getByRole("button", { name: "Mute welcome music" })).toBeVisible();
	await tour.getByRole("button", { name: "Close onboarding window" }).click();
	await expect(tour).not.toBeVisible();
	await page.evaluate(() => window.dispatchEvent(new Event("test-open-onboarding")));
	await expect(tour.getByRole("button", { name: "Mute welcome music" })).toBeVisible();
	await expect(page.locator("html")).toHaveAttribute("data-music-attempts", "2");
	await expect(page.locator("html")).toHaveAttribute("data-music-start-time", "0");
});

test("blocked welcome music retries on interaction and replays on the next onboarding", async ({
	page,
}) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
	await installDesktopBridgeOverrides(page, () => {
		let attempts = 0;
		HTMLMediaElement.prototype.play = async function () {
			if (!(this instanceof HTMLAudioElement)) return;
			attempts += 1;
			document.documentElement.dataset.musicAttempts = String(attempts);
			if (attempts === 1) throw new DOMException("Interaction required", "NotAllowedError");
		};
	});
	await page.goto("/?windowType=onboarding");
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await expect(tour.getByRole("button", { name: "Unmute welcome music" })).toBeEnabled();
	await tour.getByPlaceholder("you@example.com").click();
	await expect(tour.getByRole("button", { name: "Mute welcome music" })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await expect(page.locator("html")).toHaveAttribute("data-music-attempts", "2");
	await tour.getByRole("button", { name: "Mute welcome music" }).click();
	await tour.getByPlaceholder("you@example.com").click();
	await expect(tour.getByRole("button", { name: "Unmute welcome music" })).toBeVisible();
	await expect(page.locator("html")).toHaveAttribute("data-music-attempts", "2");
	await page.reload();
	await expect(tour).toBeVisible();
	await expect(tour.getByRole("button", { name: "Unmute welcome music" })).toBeVisible();
	await tour.getByPlaceholder("you@example.com").click();
	await expect(tour.getByRole("button", { name: "Mute welcome music" })).toBeVisible();
	await expect(page.locator("html")).toHaveAttribute("data-music-attempts", "2");
});

test("a failed welcome audio load shows no dead toggle or persisted playback flag", async ({
	page,
}) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.setAppSetting = (key, value) => {
			localStorage.setItem(`test-write:${key}`, JSON.stringify(value));
			return true;
		};
		HTMLMediaElement.prototype.play = async function () {
			if (this instanceof HTMLAudioElement)
				throw new DOMException("Missing audio", "NotSupportedError");
		};
	});
	await page.goto("/?windowType=onboarding");
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await expect(tour).toBeVisible();
	await expect(tour.locator("[data-welcome-music]")).toHaveCount(0);
	expect(
		await page.evaluate(() =>
			localStorage.getItem("test-write:recordly.first-boot-music.v1.played"),
		),
	).toBeNull();
});

test("closing during pending welcome playback does not persist a playback flag", async ({
	page,
}) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.setAppSetting = (key, value) => {
			localStorage.setItem(`test-write:${key}`, JSON.stringify(value));
			return true;
		};
		HTMLMediaElement.prototype.play = async function () {
			if (!(this instanceof HTMLAudioElement)) return;
			document.documentElement.dataset.musicPending = "true";
			await new Promise<void>((resolve) => {
				window.addEventListener("test-release-music", () => resolve(), { once: true });
			});
		};
	});
	await page.goto("/?windowType=onboarding");
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await expect(page.locator("html")).toHaveAttribute("data-music-pending", "true");
	await expect(tour.locator("[data-welcome-music]")).toHaveCount(0);
	await tour.getByRole("button", { name: "Close onboarding window" }).click();
	await expect(page.locator("html")).toHaveAttribute("data-onboarding-closed", "true");
	await page.evaluate(async () => {
		window.dispatchEvent(new Event("test-release-music"));
		await new Promise(requestAnimationFrame);
	});
	expect(
		await page.evaluate(() =>
			localStorage.getItem("test-write:recordly.first-boot-music.v1.played"),
		),
	).toBeNull();
});
