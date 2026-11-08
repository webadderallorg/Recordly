import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

for (const storageBytes of [
	220_200_000, 94_999_999_999, 95_000_000_000, 100_000_000_000, 101_000_000_000,
]) {
	test(`Cloud sidebar storage visibility at ${storageBytes} bytes; account usage stays available`, async ({
		page,
	}) => {
		await installDesktopBridge(page);
		await page.addInitScript((storageBytes) => {
			window.electronAPI.cloudBilling = async () => ({
				success: true,
				billing: {
					plan: "pro",
					subscriptionStatus: "active",
					currentPeriodEnd: null,
					cancelAtPeriodEnd: false,
					checkoutAvailable: false,
					checkoutIntervals: [],
					portalAvailable: false,
					prices: [],
				},
				usage: {
					recordings: 8,
					recordingLimit: null,
					maxRecordingBytes: 10_000_000_000,
					storageBytes,
					storageLimitBytes: 100_000_000_000,
				},
			});
		}, storageBytes);
		await page.goto("/?windowType=editor");
		await page.getByRole("button", { name: "Home", exact: true }).click();
		const dashboard = page.getByRole("dialog", { name: "Projects dashboard", exact: true });
		const sidebar = dashboard.getByLabel("Sidebar announcements", { exact: true });
		const navigation = dashboard.getByRole("complementary", { name: "Library navigation" });
		await navigation.getByRole("button", { name: "Settings", exact: true }).click();
		const settings = dashboard.getByRole("region", { name: "Dashboard settings", exact: true });
		await expect(settings).toBeVisible();
		await expect(
			settings.getByRole("region", { name: "Cloud usage", exact: true }),
		).toHaveCount(0);
		await settings.getByRole("button", { name: "Manage account", exact: true }).click();
		await expect(settings.getByLabel("Cloud usage", { exact: true })).toContainText(
			"Cloud storage",
		);
		// A rendered value proves the Pro account response has reached React before absence checks.
		await expect(
			settings.getByRole("progressbar", { name: "Cloud storage used", exact: true }),
		).toHaveAttribute("aria-valuenow", String(Math.min(storageBytes, 100_000_000_000)));
		await expect(sidebar.getByText("Loading usage…")).toHaveCount(0);
		await expect(sidebar.getByText("Cloud recordings", { exact: true })).toHaveCount(0);
		await expect(sidebar.getByLabel("Cloud usage", { exact: true })).toHaveCount(0);
		await expect(navigation.getByRole("button", { name: "Upgrade", exact: true })).toHaveCount(
			0,
		);
	});
}

for (const signedIn of [false, true]) {
	test(`${signedIn ? "Free" : "Signed-out"} library footer upgrade fits and relocated socials open through Feedback`, async ({
		page,
	}) => {
		await installDesktopBridge(page, "preview.mp4", { signedIn, onboarded: true });
		await installDesktopBridgeOverrides(page, () => {
			window.electronAPI.cloudBilling = async () => ({
				success: true,
				billing: {
					plan: "free",
					subscriptionStatus: null,
					currentPeriodEnd: null,
					cancelAtPeriodEnd: false,
					checkoutAvailable: false,
					checkoutIntervals: [],
					portalAvailable: false,
					prices: [],
				},
				usage: {
					recordings: 2,
					recordingLimit: 5,
					maxRecordingBytes: 1_000_000_000,
					storageBytes: 100_000_000,
					storageLimitBytes: 100_000_000_000,
				},
			});
			window.electronAPI.openExternalUrl = async (url: string) => {
				document.documentElement.dataset.openedExternalUrl = url;
				return { success: true };
			};
		});
		await page.goto("/?windowType=editor");
		await page.getByRole("button", { name: "Home", exact: true }).click();
		const dashboard = page.getByRole("dialog", { name: "Projects dashboard", exact: true });
		const navigation = dashboard.getByRole("complementary", { name: "Library navigation" });
		const usage = navigation.getByLabel("Cloud usage", { exact: true });
		if (signedIn) await expect(usage).toContainText("2 of 5 used");
		else await expect(usage).toHaveCount(0);
		for (const width of [1440, 800]) {
			await page.setViewportSize({ width, height: 1000 });
			const settingsButton = navigation.getByRole("button", {
				name: "Settings",
				exact: true,
			});
			await expect(settingsButton).toHaveText("Settings");
			const settingsBounds = (await settingsButton.boundingBox())!;
			const footer = navigation.locator(".community-links");
			const upgrade = footer.getByRole("button", { name: "Upgrade", exact: true });
			await expect(upgrade).toBeVisible();
			await expect(footer.getByRole("button")).toHaveCount(1);
			const upgradeBounds = (await upgrade.boundingBox())!;
			expect(settingsBounds.y + settingsBounds.height).toBeLessThanOrEqual(upgradeBounds.y);
			const navBounds = (await navigation.boundingBox())!;
			expect(upgradeBounds.x).toBeGreaterThanOrEqual(navBounds.x);
			expect(upgradeBounds.x + upgradeBounds.width).toBeLessThanOrEqual(
				navBounds.x + navBounds.width,
			);
		}
		await navigation.getByRole("button", { name: "Feedback", exact: true }).click();
		const feedback = page.getByRole("dialog", { name: "Send feedback", exact: true });
		await expect(feedback).toBeVisible();
		await feedback.getByRole("button", { name: "Socials", exact: true }).click();
		const socials = page.getByRole("dialog", { name: "Socials", exact: true });
		for (const { name, url } of [
			{ name: "Join Discord", url: "https://discord.gg/sdv2FBVNgE" },
			{ name: "GitHub", url: "https://github.com/webadderallorg/Recordly" },
		]) {
			const link = socials.getByRole("button", { name, exact: true });
			await expect(link).toBeVisible();
			await link.click();
			await expect(page.locator("html")).toHaveAttribute("data-opened-external-url", url);
		}
		await page.keyboard.press("Escape");
		await expect(socials).toHaveCount(0);
		await expect(feedback).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(feedback).toHaveCount(0);
		await navigation.getByRole("button", { name: "Settings", exact: true }).click();
		await expect(
			dashboard.getByRole("region", { name: "Dashboard settings", exact: true }),
		).toBeVisible();
	});
}
