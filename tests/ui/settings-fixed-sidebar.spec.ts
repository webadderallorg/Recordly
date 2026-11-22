import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

for (const height of [720, 600, 480, 360]) {
	test(`settings sidebar needs no scrolling at ${height}px tall`, async ({ page }) => {
		await page.setViewportSize({ width: 1000, height: 720 });
		await installDesktopBridge(page);
		await page.goto("/?windowType=editor");
		await page.getByRole("button", { name: "Settings", exact: true }).click();
		const settings = page.getByRole("dialog", { name: "Settings", exact: true });
		await expect(settings).not.toHaveAttribute("data-entering");
		await page.setViewportSize({ width: 1000, height });
		const navigation = settings.locator(".dashboard-settings-navigation");
		const account = navigation.getByRole("button", { name: "Manage account", exact: true });
		await test.info().attach("sidebar-layout", {
			contentType: "application/json",
			body: JSON.stringify(
				await navigation.evaluate((element) => {
					const nodes = [
						element.closest(".app-settings-dialog")!,
						element,
						...element.querySelectorAll(
							".dashboard-settings-tab-list, .tabs__tab, .dashboard-settings-sidebar-footer",
						),
					];
					return nodes.map((node) => {
						const rect = node.getBoundingClientRect();
						const style = getComputedStyle(node);
						return {
							className: node.className,
							text: node.textContent,
							rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
							clientHeight: node.clientHeight,
							scrollHeight: node.scrollHeight,
							height: style.height,
							padding: style.padding,
							overflow: style.overflow,
							minHeight: style.minHeight,
							gap: style.gap,
						};
					});
				}),
			),
		});
		await expect(account).toBeInViewport({ ratio: 1 });
		for (const tab of await navigation.getByRole("tab").all()) {
			await expect(tab).toBeInViewport({ ratio: 1 });
		}
		const positions = await navigation
			.getByRole("tab")
			.evaluateAll((tabs) => tabs.map((tab) => tab.getBoundingClientRect().y));
		await navigation.hover();
		await page.mouse.wheel(0, 1000);
		await expect
			.poll(() =>
				navigation
					.getByRole("tab")
					.evaluateAll((tabs) => tabs.map((tab) => tab.getBoundingClientRect().y)),
			)
			.toEqual(positions);
		await expect(navigation.locator(".tabs__list-container__scroll-next:visible")).toHaveCount(
			0,
		);
		await expect(navigation.locator(".tabs__list-container__scroll-prev:visible")).toHaveCount(
			0,
		);
		const panel = settings.getByRole("tabpanel");
		await panel.hover();
		await page.mouse.wheel(0, 10000);
		await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
		await expect
			.poll(() =>
				navigation
					.getByRole("tab")
					.evaluateAll((tabs) => tabs.map((tab) => tab.getBoundingClientRect().y)),
			)
			.toEqual(positions);
		await expect(account).toBeInViewport({ ratio: 1 });
		await settings.screenshot({ path: test.info().outputPath("fixed-sidebar.png") });
	});
}

test("storage locations stay in their info tooltips", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getRecordingsDirectory = async () => ({
			success: true,
			path: "/Users/creator/Documents/Recordly/Recordings",
		});
		window.electronAPI.getProjectsDirectory = async () => ({
			success: true,
			path: "/Users/creator/Documents/Recordly/Projects",
		});
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	const settings = page.getByRole("dialog", { name: "Settings", exact: true });
	await expect(settings.getByText("Recordings folder", { exact: true })).toBeVisible();
	await expect(settings).not.toContainText("/Users/creator");
	for (const [label, path] of [
		["Recordings folder", "/Users/creator/Documents/Recordly/Recordings"],
		["Projects folder", "/Users/creator/Documents/Recordly/Projects"],
	]) {
		await settings.getByLabel(label, { exact: true }).hover();
		await expect(page.getByRole("tooltip")).toContainText(path);
		await settings.getByRole("heading", { name: "Settings", exact: true }).hover();
		await expect(page.getByRole("tooltip")).toHaveCount(0);
	}
	await settings.screenshot({ path: test.info().outputPath("storage-tooltips.png") });
});

for (const height of [600, 760]) {
	test(`Home settings only scrolls the right pane and contains wheel input at ${height}px`, async ({
		page,
	}) => {
		test.setTimeout(60000);
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.setViewportSize({ width: 1280, height });
		await installDesktopBridge(page);
		await page.goto("/?windowType=editor");
		await page.getByRole("button", { name: "Home", exact: true }).click();
		const home = page.getByRole("dialog", { name: "Projects dashboard", exact: true });
		await home.getByRole("button", { name: "Settings", exact: true }).click();
		const settings = home.locator(".dashboard-settings");
		const navigation = settings.locator(".dashboard-settings-navigation");
		const panel = settings.getByRole("tabpanel");
		const general = navigation.getByRole("tab", { name: "General", exact: true });
		const account = navigation.getByRole("button", { name: "Manage account", exact: true });
		await expect(general).toBeInViewport({ ratio: 1 });
		await expect(account).toBeInViewport({ ratio: 1 });
		const fixedBounds = async () => ({
			settings: await settings.boundingBox(),
			navigation: await navigation.boundingBox(),
			general: await general.boundingBox(),
			account: await account.boundingBox(),
			panel: await panel.boundingBox(),
			ancestors: await panel.evaluate((element) => {
				const offsets = [];
				for (let node = element.parentElement; node; node = node.parentElement)
					offsets.push({
						tag: node.tagName,
						className: node.className,
						top: node.scrollTop,
						left: node.scrollLeft,
					});
				return { offsets, windowX: window.scrollX, windowY: window.scrollY };
			}),
		});
		// Wait for native wheel handling and its compositor frames before checking
		// positions, including wheel input past the panel's top and bottom edges.
		const settleWheel = () =>
			page.evaluate(
				() =>
					new Promise<void>((resolve) => {
						let frame = 0;
						const tick = () => {
							if (++frame === 6) resolve();
							else requestAnimationFrame(tick);
						};
						requestAnimationFrame(tick);
					}),
			);
		const before = await fixedBounds();
		await panel.hover();
		await page.mouse.wheel(0, 10000);
		await settleWheel();
		await test.info().attach("home-settings-wheel", {
			contentType: "application/json",
			body: JSON.stringify({
				before,
				after: await fixedBounds(),
				panelScroll: await panel.evaluate((element) => ({
					top: element.scrollTop,
					height: element.clientHeight,
					content: element.scrollHeight,
				})),
			}),
		});
		await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(50);
		await expect(settings.getByText("Experimental updates", { exact: true })).toBeInViewport();
		expect(await fixedBounds()).toEqual(before);
		for (const target of [panel, navigation]) {
			await target.hover();
			await page.mouse.wheel(0, 1500);
			await settleWheel();
			expect(await fixedBounds()).toEqual(before);
		}
		await panel.hover();
		await page.mouse.wheel(0, -10000);
		await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBe(0);
		await page.mouse.wheel(0, -1500);
		await settleWheel();
		expect(await fixedBounds()).toEqual(before);
		await expect(general).toBeInViewport({ ratio: 1 });
		await expect(account).toBeInViewport({ ratio: 1 });
		await home.screenshot({ path: test.info().outputPath("home-settings-fixed.png") });
	});
}

for (const { width, height, theme, signedIn } of [
	{ width: 1000, height: 600, theme: "dark", signedIn: true },
	{ width: 1280, height: 760, theme: "light", signedIn: true },
	{ width: 1000, height: 600, theme: "light", signedIn: false },
] as const) {
	test(`Feedback Socials and Contact open Recordly accounts (${theme}, ${width}×${height}, signedIn=${signedIn})`, async ({
		page,
	}) => {
		test.setTimeout(60000);
		await page.setViewportSize({ width, height });
		await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
		await installDesktopBridge(page, undefined, { signedIn });
		await page.addInitScript((value) => localStorage.setItem("recordly.theme", value), theme);
		await installDesktopBridgeOverrides(page, () => {
			window.electronAPI.openExternalUrl = async (url) => {
				document.documentElement.dataset.openedCommunityUrl = url;
				return { success: true };
			};
		});
		await page.goto("/?windowType=editor");
		await page.getByRole("button", { name: "Home", exact: true }).click();
		const home = page.getByRole("dialog", { name: "Projects dashboard", exact: true });
		await expect(home.getByRole("button", { name: "Socials", exact: true })).toHaveCount(0);
		await expect(home.getByRole("button", { name: "Contact", exact: true })).toHaveCount(0);
		await home.getByRole("button", { name: "Feedback", exact: true }).click();
		const feedback = page.getByRole("dialog", { name: "Send feedback", exact: true });
		if (signedIn)
			await feedback
				.getByRole("textbox", { name: "Description" })
				.fill("Keep my feedback draft");
		const socials = feedback.getByRole("button", { name: "Socials", exact: true });
		await expect(socials).toBeInViewport({ ratio: 1 });
		const contact = feedback.getByRole("button", { name: "Contact", exact: true });
		await expect(contact).toBeInViewport({ ratio: 1 });
		const socialsBox = (await socials.boundingBox())!;
		const contactBox = (await contact.boundingBox())!;
		expect(contactBox.y).toBe(socialsBox.y);
		expect(contactBox.x).toBeGreaterThanOrEqual(socialsBox.x + socialsBox.width);

		await expect(home.getByRole("button", { name: "YouTube", exact: true })).toHaveCount(0);
		await socials.click();
		const links = page.getByRole("dialog", { name: "Socials", exact: true });
		await expect(links).toBeVisible();
		const url = page.url();
		for (const [name, label, target] of [
			["Join Discord", "Discord", "https://discord.gg/sdv2FBVNgE"],
			["GitHub", "GitHub", "https://github.com/webadderallorg/Recordly"],
			["X", "X", "https://x.com/RecordlyHQ"],
			["YouTube", "YouTube", "https://www.youtube.com/@recordlydev"],
		]) {
			const button = links.getByRole("button", { name, exact: true });
			await expect(button).toHaveText(label);
			await expect(button).toBeInViewport({ ratio: 1 });
			if (name === "YouTube") {
				await button.focus();
				await page.keyboard.press("Enter");
			} else {
				await button.click();
			}
			await expect(page.locator("html")).toHaveAttribute("data-opened-community-url", target);
			await expect(page).toHaveURL(url);
		}
		await links.screenshot({ path: test.info().outputPath(`socials-${theme}.png`) });
		await page.keyboard.press("Escape");
		await expect(links).toBeHidden();
		await expect(socials).toBeFocused();
		await expect(feedback).toBeVisible();
		await feedback.screenshot({ path: test.info().outputPath(`feedback-${theme}.png`) });
		await contact.click();
		const contactDialog = page.getByRole("dialog", { name: "Contact", exact: true });
		await expect(contactDialog).toBeVisible();
		for (const email of ["support@recordly.dev", "youngchen3442@gmail.com"]) {
			const emailButton = contactDialog.getByRole("button", { name: email, exact: true });
			await expect(emailButton).toBeInViewport({ ratio: 1 });
			await emailButton.focus();
			await page.keyboard.press("Enter");
			await expect(page.locator("html")).toHaveAttribute(
				"data-opened-community-url",
				`mailto:${email}`,
			);
			await expect(page).toHaveURL(url);
		}
		await contactDialog.screenshot({ path: test.info().outputPath(`contact-${theme}.png`) });
		await page.keyboard.press("Escape");
		await expect(contactDialog).toBeHidden();
		await expect(contact).toBeFocused();
		await expect(feedback).toBeVisible();
		if (signedIn)
			await expect(feedback.getByRole("textbox", { name: "Description" })).toHaveValue(
				"Keep my feedback draft",
			);
	});
}

test("Japanese library keeps a single Upgrade action and feedback contains Socials", async ({
	page,
}) => {
	test.setTimeout(60000);
	await page.setViewportSize({ width: 1000, height: 600 });
	await page.emulateMedia({ reducedMotion: "reduce" });
	await installDesktopBridge(page);
	await page.addInitScript(() => localStorage.setItem("recordly.locale", "ja"));
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "ホーム", exact: true }).click();
	const home = page.getByRole("dialog", { name: "プロジェクト一覧", exact: true });
	const header = home.locator(".app-frame-header");
	const upgrade = home.getByRole("button", { name: "アップグレード", exact: true });
	await expect(upgrade).toHaveCount(1);
	await expect(upgrade).toBeInViewport({ ratio: 1 });
	await expect(header.getByRole("button", { name: "アップグレード", exact: true })).toBeVisible();
	await home.getByRole("button", { name: "フィードバック", exact: true }).click();
	const feedback = page.getByRole("dialog", { name: "フィードバックを送信", exact: true });
	const socials = feedback.getByRole("button", { name: "SNS", exact: true });
	await expect(socials).toBeVisible();
	await socials.click();
	const modal = page.getByRole("dialog", { name: "SNS", exact: true });
	await expect(modal.getByRole("button", { name: "YouTube", exact: true })).toBeInViewport({
		ratio: 1,
	});
	await modal.screenshot({ path: test.info().outputPath("socials-ja.png") });
	await modal.getByRole("button", { name: "閉じる", exact: true }).click();
	await expect(modal).toBeHidden();
	await expect(socials).toBeFocused();
});
