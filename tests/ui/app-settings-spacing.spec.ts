import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

for (const width of [1440, 760, 700, 420, 320]) {
	for (const theme of ["Light", "Dark"]) {
		test(`Settings spacing remains aligned at ${width}px in ${theme.toLowerCase()} mode`, async ({
			page,
		}) => {
			test.setTimeout(60000);
			await page.setViewportSize({ width, height: 900 });
			await installDesktopBridge(page);
			await installDesktopBridgeOverrides(page, () => {
				let preferences = {
					success: true,
					showInDock: true,
					hideWhileRecording: false,
					launchAtLogin: false,
					launchAtLoginSupported: true,
					platform: "darwin",
				};
				window.electronAPI.getApplicationPreferences = async () => preferences;
				window.electronAPI.setApplicationPreferences = async (patch) => {
					preferences = { ...preferences, ...patch };
					return preferences;
				};
			});
			await page.goto("/?windowType=editor");
			await page.getByRole("button", { name: "Recordly account", exact: true }).click();
			await page
				.getByRole("dialog", { name: "Account menu", exact: true })
				.getByRole("button", { name: "Appearance", exact: true })
				.click();
			const settings = page.getByRole("dialog", { name: "Settings", exact: true });
			await settings.getByText(theme, { exact: true }).click();
			await expect(settings).not.toHaveAttribute("data-entering");
			const baseline = (await settings.getByRole("tabpanel").boundingBox())!;
			for (const category of [
				"General",
				"Shortcuts",
				"Account",
				"Recording",
				"Motion",
				...(process.env.RECORDLY_TEST_PRODUCTION === "1" ? [] : ["Dev"]),
			]) {
				await settings.getByRole("tab", { name: category, exact: true }).click();
				const panel = settings.getByRole("tabpanel");
				if (category === "General")
					await expect(
						panel.getByRole("switch", {
							name: "Show Recordly in the Dock",
							exact: true,
						}),
					).toBeVisible();
				const heading = panel.locator(".dashboard-settings-group h2:visible").first();
				await expect(heading).toBeVisible();
				const headingBox = (await heading.boundingBox())!;
				expect(
					Math.abs(headingBox.x - baseline.x),
					`${category} heading left edge`,
				).toBeLessThan(1);
				expect(
					Math.abs(headingBox.y - baseline.y),
					`${category} heading top edge`,
				).toBeLessThan(1);
				expect(
					await panel.evaluate((e) => e.scrollWidth <= e.clientWidth),
					`${category} overflow`,
				).toBe(true);
				const rowInsets = await panel.locator(".settings-row:visible").evaluateAll((rows) =>
					rows
						.filter(
							(row) =>
								getComputedStyle(row.querySelector(".settings-row-copy")!)
									.display !== "contents",
						)
						.map((row) => {
							const panel = row.closest('[role="tabpanel"]')!;
							const copy = row.querySelector(".settings-row-copy")!;
							return (
								copy.getBoundingClientRect().left -
								panel.getBoundingClientRect().left
							);
						}),
				);
				for (const inset of rowInsets)
					expect(Math.abs(inset), `${category} row inset`).toBeLessThan(1);

				for (const group of await panel.locator(".settings-group:visible").all()) {
					const borders = await group.evaluate((element) => {
						const style = getComputedStyle(element);
						return [style.borderLeftWidth, style.borderRightWidth, style.borderRadius];
					});
					expect(borders, `${category} has no enclosing section box`).toEqual([
						"0px",
						"0px",
						"0px",
					]);
				}
				if (category === "Account") {
					for (const form of await panel.locator(".account-settings-form").all()) {
						const title = (await form.locator("h3").boundingBox())!;
						const field = (await form.locator(".textfield").boundingBox())!;
						expect(Math.abs(field.y - title.y - title.height - 8)).toBeLessThan(1);
					}
				}
				if (category === "Account" || category === "General") {
					const panelColor = await settings.evaluate(
						(element) => getComputedStyle(element).backgroundColor,
					);
					const fields = panel.locator(
						category === "Account"
							? ".account-settings-form input"
							: ".settings-language-trigger",
					);
					for (const field of await fields.all()) {
						const color = await field.evaluate(
							(element) => getComputedStyle(element).backgroundColor,
						);
						expect(color, `${category} editable field surface`).not.toBe(panelColor);
					}
				}
				if (category === "Motion") {
					const cards = await panel
						.locator('.settings-motion-presets [data-slot="radio"]')
						.all();
					const first = (await cards[0].boundingBox())!;
					const second = (await cards[1].boundingBox())!;
					expect(Math.abs(second.y - first.y - first.height - 8)).toBeLessThan(1);
				}
				const dividers = await panel
					.locator(".settings-item > .settings-row")
					.evaluateAll((rows) =>
						rows.map((row) => getComputedStyle(row).borderBottomWidth),
					);
				for (const divider of dividers) expect(divider).toBe("0px");
				if (baseline.width <= 480) {
					const toggles = await panel
						.locator(".settings-row:has(.switch__control):visible")
						.evaluateAll((rows) =>
							rows.map((row) => {
								const copy = row
									.querySelector(".settings-row-copy")!
									.getBoundingClientRect();
								const toggle = row
									.querySelector(".switch__control")!
									.getBoundingClientRect();
								return toggle.left >= copy.right && toggle.top < copy.bottom;
							}),
						);
					for (const inline of toggles)
						expect(inline, `${category} inline toggle`).toBe(true);
				}
				if (width <= 680) {
					const scroller = (await settings
						.locator(".tabs__list-container__scroller")
						.boundingBox())!;
					for (const direction of ["prev", "next"]) {
						const arrow = settings.locator(
							`.tabs__list-container__scroll-${direction}`,
						);
						if (await arrow.isVisible()) {
							const box = (await arrow.boundingBox())!;
							expect(
								box.x + box.width <= scroller.x ||
									box.x >= scroller.x + scroller.width,
							).toBe(true);
						}
					}
				}
				const heights = await panel
					.locator(
						".button:visible:not(.theme-preview *), .theme-appearance-option:visible",
					)
					.evaluateAll((buttons) =>
						buttons.map((button) => button.getBoundingClientRect().height),
					);

				for (const height of heights)
					expect(height, `${category} action height`).toBeGreaterThanOrEqual(35.5);
				await settings.screenshot({
					path: `test-results/settings-spacing-${width}-${theme.toLowerCase()}-${category.toLowerCase()}.png`,
					animations: "disabled",
				});
			}
			await settings.getByRole("tab", { name: "Account", exact: true }).click();
			const card = settings.locator(".account-settings-cloud .cloud-usage-card");
			const geometry = await card.evaluate((element) => {
				const header = element.querySelector(".card__header")!.getBoundingClientRect();
				const content = element.querySelector(".card__content")!.getBoundingClientRect();
				return {
					width: element.getBoundingClientRect().width,
					headerBottom: header.bottom,
					contentTop: content.top,
				};
			});
			if (geometry.width <= 560)
				expect(geometry.contentTop).toBeGreaterThan(geometry.headerBottom);
			await card.scrollIntoViewIfNeeded();
			await settings.screenshot({
				path: `test-results/settings-spacing-${width}-${theme.toLowerCase()}-account-storage.png`,
				animations: "disabled",
			});
			await settings.getByRole("tabpanel").evaluate((element) => {
				element.scrollTop = element.scrollHeight;
			});
			await expect(
				settings.getByRole("button", { name: "Sign out of all devices", exact: true }),
			).toBeInViewport();
			await settings.screenshot({
				path: `test-results/settings-spacing-${width}-${theme.toLowerCase()}-account-bottom.png`,
				animations: "disabled",
			});
		});
	}
}

test("permission recovery errors align with their row and retain error emphasis", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.openMediaPermissionPreferences = async () => ({
			success: false,
			error: "System Settings unavailable",
		});
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Recordly account", exact: true }).click();
	await page
		.getByRole("dialog", { name: "Account menu", exact: true })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	const settings = page.getByRole("dialog", { name: "Settings", exact: true });
	await settings.getByRole("tab", { name: "Recording", exact: true }).click();
	await settings
		.getByRole("button", { name: "Open System Settings: Camera", exact: true })
		.click();
	const error = settings.getByRole("alert");
	await expect(error).toHaveText("Could not open System Settings. Try again. Report error");
	await expect(error.getByRole("button", { name: "Report error", exact: true })).toBeVisible();
	const style = await error.evaluate((element) => {
		const description =
			element.previousElementSibling!.querySelector(".settings-row-copy")!.lastElementChild!;
		return {
			errorColor: getComputedStyle(element).color,
			descriptionColor: getComputedStyle(description).color,
			errorX: element.getBoundingClientRect().x,
			descriptionX: description.getBoundingClientRect().x,
		};
	});
	expect(style.errorColor).not.toBe(style.descriptionColor);
	expect(Math.abs(style.errorX - style.descriptionX)).toBeLessThan(1);
});
