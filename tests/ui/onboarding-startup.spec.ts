import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

for (const colorScheme of ["light", "dark"] as const) {
	test(`onboarding uses its window background before JavaScript in ${colorScheme} mode`, async ({
		page,
	}) => {
		await page.emulateMedia({ colorScheme });
		await page.route("**/src/main.tsx*", (route) => route.abort());
		await page.goto("/?windowType=onboarding");
		await expect(page.locator("[data-onboarding-loading]")).toHaveCount(0);
		await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
		await expect(page.locator("html")).toHaveCSS(
			"background-color",
			colorScheme === "dark" ? "rgb(23, 23, 25)" : "rgb(246, 246, 247)",
		);
	});
}

for (const signedIn of [false, true]) {
	test(`onboarding shows real controls during session recovery (${signedIn ? "saved account" : "signed out"})`, async ({
		page,
	}) => {
		await page.setViewportSize({ width: 760, height: 760 });
		await page.emulateMedia({ reducedMotion: "reduce" });
		await installDesktopBridge(page, "preview.mp4", { signedIn, onboarded: false });
		await installDesktopBridgeOverrides(page, () => {
			const getItem = window.electronAPI.authStorageGetItem;
			const ready = new Promise<void>((resolve) => {
				window.addEventListener("test-release-auth", () => resolve(), { once: true });
			});
			window.electronAPI.authStorageGetItem = async (key) => {
				document.documentElement.dataset.authPending = "true";
				await ready;
				return getItem(key);
			};
		});
		let releaseProviders!: () => void;
		const providersReady = new Promise<void>((resolve) => {
			releaseProviders = resolve;
		});
		await page.route("**/auth/v1/settings", async (route) => {
			await providersReady;
			await route.fulfill({
				json: { external: { google: true, azure: true, apple: true } },
			});
		});
		// Even unavailable artwork cannot gate the form.
		await page.route("**/auth/recordly-demo.*", (route) => route.abort());
		await page.goto("/?windowType=onboarding", { waitUntil: "domcontentloaded" });
		const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
		await expect(page.locator("html")).toHaveAttribute("data-auth-pending", "true", {
			timeout: 15000,
		});
		await expect(tour).toBeVisible();
		await expect(page.locator("[data-onboarding-loading]")).toHaveCount(0);
		await expect(
			tour.getByRole("heading", { name: "Welcome to Recordly", exact: true }),
		).toBeVisible();
		const email = tour.getByPlaceholder("you@example.com");
		await email.fill("person@example.com");
		await expect(
			tour.getByRole("button", { name: "Email me a code", exact: true }),
		).toBeEnabled();
		for (const provider of ["Google", "Microsoft", "Apple"]) {
			await expect(
				tour.getByRole("button", { name: `Continue with ${provider}` }),
			).toBeVisible();
			await expect(
				tour.getByRole("button", { name: `Continue with ${provider}` }),
			).toBeDisabled();
		}
		const before = await email.boundingBox();
		if (!signedIn)
			await page.screenshot({
				path: test.info().outputPath("pending-session.png"),
			});
		releaseProviders();
		await expect(tour.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
		await expect(email).toHaveValue("person@example.com");
		expect(await email.boundingBox()).toEqual(before);
		await expect(email).toHaveValue("person@example.com");
		await tour.getByRole("button", { name: "Continue", exact: true }).click();
		await expect(tour.getByRole("heading", { name: "Allow Recordly to record" })).toBeVisible();
		await page.evaluate(() => window.dispatchEvent(new Event("test-release-auth")));
		await expect(tour).toHaveAttribute("data-onboarding-state", "permissions");
	});
}

test("provider discovery failure leaves the real email form usable", async ({ page }) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
	await page.route("**/auth/v1/settings", (route) => route.abort());
	await page.goto("/?windowType=onboarding");
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await tour.getByPlaceholder("you@example.com").fill("person@example.com");
	await expect(tour.getByRole("button", { name: "Email me a code", exact: true })).toBeEnabled();
	await expect(tour.getByRole("button", { name: "Continue with Google" })).toBeVisible();
	await expect(tour.getByRole("button", { name: "Continue with Google" })).toBeDisabled();
	await tour.getByRole("button", { name: "Close onboarding window" }).click();
	await expect(page.locator("html")).toHaveAttribute("data-onboarding-closed", "true");
});

test("a signed-out editor opens onboarding before project hydration finishes", async ({ page }) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.loadCurrentProjectFile = async () => {
			document.documentElement.dataset.projectPending = "true";
			await new Promise<void>((resolve) => {
				window.addEventListener("test-release-project", () => resolve(), { once: true });
			});
			return { success: false };
		};
		window.electronAPI.showOnboardingWindow = async () => {
			document.documentElement.dataset.onboardingRequested = "true";
			return false;
		};
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator("html")).toHaveAttribute("data-project-pending", "true");
	await expect(page.locator("html")).toHaveAttribute("data-onboarding-requested", "true");
	await expect(page.getByRole("dialog", { name: "Welcome to Recordly" })).toBeVisible();
	await page.evaluate(() => window.dispatchEvent(new Event("test-release-project")));
});
