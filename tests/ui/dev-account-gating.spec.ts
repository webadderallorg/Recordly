import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";
import { productionTest } from "./production";

test("dev skip survives editor reloads and stale production permission requests", async ({
	page,
}) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
	await installDesktopBridgeOverrides(page, () => {
		const getSetting = window.electronAPI.getAppSetting;
		window.electronAPI.getAppSetting = (key) => {
			if (key === "recordly.dev.onboardingDismissed")
				return localStorage.getItem(key) === "true";
			if (key === "recordly.onboarding.permissionsRequested") return true;
			return getSetting(key);
		};
		window.electronAPI.setAppSetting = (key, value) => {
			if (key === "recordly.dev.onboardingDismissed")
				localStorage.setItem(key, String(value));
			else if (key.startsWith("recordly.onboarding."))
				throw new Error("Production settings changed");
			return true;
		};
		window.electronAPI.showOnboardingWindow = async () => false;
	});
	await page.goto("/?windowType=editor");
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await tour.getByRole("button", { name: "Skip onboarding", exact: true }).click();
	await expect(tour).not.toBeVisible();
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem("recordly.dev.onboardingDismissed")))
		.toBe("true");
	await page.reload();
	await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
	await expect(tour).not.toBeVisible();
	await expect(
		page.getByRole("dialog", { name: "Sign in to Recordly", exact: true }),
	).not.toBeVisible();
});

for (const dev of [true, false]) {
	const modeTest = dev ? test : productionTest;
	modeTest(
		`${dev ? "dev records without an account" : "production requires an account"} with recording permissions granted`,
		async ({ page }) => {
			await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: true });
			await installDesktopBridgeOverrides(page, () => {
				window.electronAPI.getCountdownDelay = async () => ({ success: true, delay: 0 });
				window.electronAPI.startNativeScreenRecording = async () => {
					document.documentElement.dataset.captureStarted = "true";
					return { success: true };
				};
			});
			await page.goto("/?windowType=hud-overlay");
			await page.getByRole("button", { name: "Record", exact: true }).click();
			if (dev) {
				await expect(page.locator("html")).toHaveAttribute("data-capture-started", "true");
				await expect(page.locator("html")).not.toHaveAttribute("data-permissions-opened");
			} else {
				await expect(page.locator("html")).toHaveAttribute(
					"data-permissions-opened",
					"true",
				);
				await expect(page.locator("html")).not.toHaveAttribute("data-capture-started");
			}
		},
	);
}

for (const dev of [true, false]) {
	const modeTest = dev ? test : productionTest;
	modeTest(
		`${dev ? "dev does not refresh" : "production still refreshes"} the account on a background timer`,
		async ({ page }) => {
			await page.clock.install();
			await installDesktopBridge(page, "preview.mp4", { signedIn: true, onboarded: true });
			const tokenRequests: string[] = [];
			page.on("request", (request) => {
				if (request.url().includes("/auth/v1/token")) tokenRequests.push(request.url());
			});
			await page.goto("/?windowType=editor");
			await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
			await page.clock.fastForward(3_660_000);
			if (dev) {
				await page.waitForTimeout(100);
				expect(tokenRequests).toEqual([]);
			} else await expect.poll(() => tokenRequests.length).toBeGreaterThan(0);
		},
	);
}

productionTest("production ignores a saved dev dismissal", async ({ page }) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
	await installDesktopBridgeOverrides(page, () => {
		const getSetting = window.electronAPI.getAppSetting;
		window.electronAPI.getAppSetting = (key) =>
			key === "recordly.dev.onboardingDismissed" ? true : getSetting(key);
	});
	await page.goto("/?windowType=editor");
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await expect(tour).toBeVisible();
	await expect(tour.getByRole("button", { name: "Skip onboarding", exact: true })).toHaveCount(0);
	await expect(tour.getByRole("button", { name: "Permissions", exact: true })).toBeDisabled();
});
