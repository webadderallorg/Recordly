import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("Home reveals a loaded project grid immediately and batches share settings reads", async ({
	page,
}) => {
	test.slow();
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: true });
	await installDesktopBridgeOverrides(page, () => {
		const readSetting = window.electronAPI.getAppSettingWithStatus;
		window.electronAPI.getEditorStartupView = () => "home";
		window.electronAPI.getCurrentVideoPath = async () => ({ success: false });
		window.electronAPI.getAppSettingWithStatus = (key) => {
			if (key !== "recordly.project-share-links.v1") return readSetting(key);
			const doc = document.documentElement;
			doc.dataset.shareReads = String(Number(doc.dataset.shareReads ?? 0) + 1);
			return {
				success: true,
				found: true,
				value: {
					"/projects/0.recordly": { url: "https://example.com/shared", sharedAt: 2 },
					"/projects/1.recordly": {
						url: "https://example.com/private",
						sharedAt: 2,
						accountId: "another-account",
					},
				},
			};
		};
		window.electronAPI.listProjectFiles = async () => {
			await new Promise<void>((resolve) => {
				window.addEventListener("test-release-project-list", () => resolve(), {
					once: true,
				});
			});
			return {
				success: true,
				entries: Array.from({ length: 24 }, (_, index) => ({
					path: `/projects/${index}.recordly`,
					name: `Home project ${index}`,
					updatedAt: 1,
					thumbnailPath: null,
					isCurrent: false,
					isInProjectsDirectory: true,
				})),
			};
		};
	});
	await page.goto("/?windowType=editor&startupView=home");
	const home = page.getByRole("dialog", { name: "Projects dashboard" });
	await expect(home.getByLabel("Loading projects")).toBeVisible({ timeout: 45000 });
	const result = await page.evaluate(() => {
		const doc = document.documentElement;
		const before = Number(doc.dataset.shareReads ?? 0);
		return new Promise<{ reads: number; opacity: string; skeletonPresent: boolean }>(
			(resolve) => {
				const observer = new MutationObserver(() => {
					const list = document.querySelector(
						'.dashboard-shell main ul[aria-label="Your projects"]',
					);
					if (!list) return;
					observer.disconnect();
					resolve({
						reads: Number(doc.dataset.shareReads ?? 0) - before,
						opacity: getComputedStyle(list.parentElement!).opacity,
						skeletonPresent: !!document.querySelector(
							".dashboard-shell main [aria-busy=true]",
						),
					});
				});
				observer.observe(document.body, { subtree: true, childList: true });
				window.dispatchEvent(new Event("test-release-project-list"));
			},
		);
	});
	expect(result).toMatchObject({ opacity: "1", skeletonPresent: false });
	expect(result.reads).toBeGreaterThan(0);
	// StrictMode and startup updates can render more than once; even one read per card would be 24.
	expect(result.reads).toBeLessThan(12);
	await expect(
		home.getByRole("list", { name: "Your projects" }).locator(":scope > li"),
	).toHaveCount(24);
	await expect(
		home.getByRole("button", { name: "View share link for Home project 0" }),
	).toBeVisible();
	await expect(
		home.getByRole("button", { name: "View share link for Home project 1" }),
	).toHaveCount(0);
});

test("Home stays opaque throughout its loading transition over the editor", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		const save = window.electronAPI.saveProjectFile;
		window.electronAPI.saveProjectFile = async (...args) => {
			if (args[3])
				await new Promise<void>((resolve) => {
					window.addEventListener("test-release-home-save", () => resolve(), {
						once: true,
					});
				});
			return save(...args);
		};
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator(".editor-inspector")).toBeVisible({ timeout: 30000 });
	await expect(page.locator("html")).toHaveAttribute("data-project-creates", "1");
	await page.evaluate(() => {
		const samples: number[] = [];
		Object.assign(window, { homeOpacitySamples: samples });
		const sample = () => {
			const home = document.querySelector(".dashboard-shell");
			if (home) {
				const backdrop = home.closest(".modal__backdrop")!;
				const container = home.closest(".modal__container")!;
				samples.push(
					Number(getComputedStyle(backdrop).opacity) *
						Number(getComputedStyle(container).opacity),
				);
			}
			if (!(window as unknown as { homeSamplingDone?: boolean }).homeSamplingDone)
				requestAnimationFrame(sample);
		};
		requestAnimationFrame(sample);
	});
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const home = page.getByRole("dialog", { name: "Projects dashboard" });
	await expect(home).toBeVisible();
	await expect(home.getByLabel("Loading projects")).toHaveCount(0);
	const samples = await page.evaluate(async () => {
		const start = performance.now();
		const state = window as unknown as {
			homeOpacitySamples: number[];
			homeSamplingDone: boolean;
		};
		while (performance.now() - start < 350 || state.homeOpacitySamples.length < 3)
			await new Promise(requestAnimationFrame);
		state.homeSamplingDone = true;
		return state.homeOpacitySamples;
	});
	expect(samples.length).toBeGreaterThan(2);
	expect(Math.min(...samples), "Home must never fade through to the editor").toBe(1);
	await page.evaluate(() => window.dispatchEvent(new Event("test-release-home-save")));
	await expect(home.getByLabel("Loading projects")).toHaveCount(0);
	await home.getByRole("button", { name: "Resume Untitled Project", exact: true }).click();
	await expect(home).not.toBeVisible();
	await expect(page.locator(".editor-inspector")).toBeVisible();
});
