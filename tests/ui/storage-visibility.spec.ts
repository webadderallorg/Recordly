import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

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
		// Wait for the account response before checking that a healthy account is hidden.
		await expect(sidebar.getByText("Loading usage…")).toHaveCount(0);
		await expect(sidebar.getByText("Cloud recordings", { exact: true })).toHaveCount(0);
		await expect(sidebar.getByLabel("Cloud usage", { exact: true })).toHaveCount(0);
		const navigation = dashboard.getByRole("complementary", { name: "Library navigation" });
		await expect(navigation.getByRole("button", { name: "Upgrade", exact: true })).toHaveCount(
			0,
		);
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
	});
}

for (const signedIn of [false, true]) {
	test(`${signedIn ? "Free" : "Signed-out"} library keeps footer actions on one line and opens Settings`, async ({
		page,
	}) => {
		await installDesktopBridge(page, "preview.mp4", { signedIn, onboarded: true });
		await page.addInitScript(() => {
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
			const bounds = [];
			const settingsButton = navigation.getByRole("button", {
				name: "Settings",
				exact: true,
			});
			await expect(settingsButton).toHaveText("Settings");
			const settingsBounds = (await settingsButton.boundingBox())!;
			for (const name of ["Upgrade", "Join Discord", "GitHub"]) {
				const button = navigation.getByRole("button", { name, exact: true });
				await expect(button).toBeVisible();
				bounds.push((await button.boundingBox())!);
			}
			expect(settingsBounds.y + settingsBounds.height).toBeLessThanOrEqual(bounds[0].y);
			for (let index = 1; index < bounds.length; index++) {
				expect(
					Math.abs(
						bounds[index].y +
							bounds[index].height / 2 -
							bounds[0].y -
							bounds[0].height / 2,
					),
				).toBeLessThan(1);
				expect(bounds[index].x).toBeGreaterThanOrEqual(
					bounds[index - 1].x + bounds[index - 1].width,
				);
			}
			const navBounds = (await navigation.boundingBox())!;
			expect(bounds.at(-1)!.x + bounds.at(-1)!.width).toBeLessThanOrEqual(
				navBounds.x + navBounds.width,
			);
		}
		await navigation.getByRole("button", { name: "Settings", exact: true }).click();
		await expect(
			dashboard.getByRole("region", { name: "Dashboard settings", exact: true }),
		).toBeVisible();
	});
}
