import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

for (const reducedMotion of ["no-preference", "reduce"] as const) {
	test(`editor reveals loaded content with ${reducedMotion} motion`, async ({ page }) => {
		await page.emulateMedia({ reducedMotion });
		await installDesktopBridge(page);
		await installDesktopBridgeOverrides(page, () => {
			window.electronAPI.getCurrentVideoPath = async () => {
				await new Promise<void>((resolve) => {
					window.addEventListener("test-release-loading", () => resolve(), {
						once: true,
					});
					document.documentElement.dataset.loadingHeld = "true";
				});
				return { success: true, path: `${location.origin}/tests/ui/fixtures/preview.mp4` };
			};
		});
		await page.goto("/?windowType=editor");
		await expect(page.locator("html")).toHaveAttribute("data-loading-held", "true");
		await expect(
			page.getByRole("status", { name: "Loading editor", exact: true }),
		).toBeVisible();
		// Pause the reveal at its midpoint to verify both layers, without relying on wall-clock timing.
		await page.evaluate(() => {
			const observer = new MutationObserver(() => {
				const reveal = document.querySelector(
					".loading-transition > .loading-content-enter",
				);
				if (!reveal) return;
				const animation = reveal.getAnimations()[0];
				if (animation) {
					animation.pause();
					animation.currentTime = 90;
					document.documentElement.dataset.revealOpacity =
						getComputedStyle(reveal).opacity;
				} else {
					document.documentElement.dataset.revealOpacity =
						getComputedStyle(reveal).opacity;
				}
				const placeholder = document.querySelector(
					".loading-placeholder[data-retiring=true]",
				);
				document.documentElement.dataset.retiringHidden = String(
					placeholder?.getAttribute("aria-hidden") === "true" &&
						placeholder.hasAttribute("inert"),
				);
				observer.disconnect();
			});
			observer.observe(document.getElementById("root")!, { subtree: true, childList: true });
			window.dispatchEvent(new Event("test-release-loading"));
		});
		await expect(page.locator("html")).toHaveAttribute("data-retiring-hidden", "true");
		const opacity = Number(await page.locator("html").getAttribute("data-reveal-opacity"));
		if (reducedMotion === "reduce") expect(opacity).toBe(1);
		else {
			expect(opacity).toBeGreaterThan(0);
			expect(opacity).toBeLessThan(1);
		}
		await expect(page.locator(".loading-placeholder")).toHaveCount(0);
		await expect(page.locator(".editor-inspector")).toBeVisible();
		await expect(page.getByRole("status", { name: "Loading editor", exact: true })).toHaveCount(
			0,
		);
	});
}

for (const width of [1440, 800]) {
	test(`Home bootstrap, React skeleton and loaded frame align at ${width}px`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 900 });
		await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: true });
		await installDesktopBridgeOverrides(page, () => {
			window.electronAPI.getEditorStartupView = () => "home";
			window.electronAPI.getCurrentUpdateToastPayload = async () => null;
			window.electronAPI.loadCurrentProjectFile = async () => ({ success: false });
			window.electronAPI.getCurrentRecordingSession = async () => ({
				success: false,
				session: null,
			});
			window.electronAPI.getCurrentVideoPath = async () => {
				await new Promise<void>((resolve) => {
					window.addEventListener("test-release-home-frame", () => resolve(), {
						once: true,
					});
					document.documentElement.dataset.homeFrameHeld = "true";
				});
				return { success: false, path: null };
			};
		});
		await page.route("**/src/main.tsx*", (route) => route.abort());
		await page.goto("/?windowType=editor&startupView=home");
		const bootstrap = {
			header: await page.locator(".boot-home .boot-header").boundingBox(),
			sidebar: await page.locator(".boot-home-sidebar").boundingBox(),
			panel: await page.locator(".boot-home-panel").boundingBox(),
		};
		await page.unroute("**/src/main.tsx*");
		await page.reload();
		await expect(page.locator("html")).toHaveAttribute("data-home-frame-held", "true");
		const skeleton = {
			header: await page.locator(".app-frame-header").boundingBox(),
			sidebar: await page.locator("[data-loading-home-sidebar]").boundingBox(),
			panel: await page.locator("[data-loading-home-panel]").boundingBox(),
		};
		await page.evaluate(() => window.dispatchEvent(new Event("test-release-home-frame")));
		const dashboard = page.getByRole("dialog", { name: "Projects dashboard", exact: true });
		await expect(dashboard).toBeVisible();
		const live = {
			header: await dashboard.locator(".app-frame-header").boundingBox(),
			sidebar: await dashboard
				.getByRole("complementary", { name: "Library navigation" })
				.boundingBox(),
			panel: await dashboard.locator(".app-frame-surface").boundingBox(),
		};
		for (const region of ["header", "sidebar", "panel"] as const) {
			for (const dimension of ["x", "y", "width", "height"] as const) {
				for (const placeholder of [bootstrap, skeleton]) {
					expect(
						Math.abs(placeholder[region]![dimension] - live[region]![dimension]),
						`${region} ${dimension}`,
					).toBeLessThan(2);
				}
			}
		}
	});
}
