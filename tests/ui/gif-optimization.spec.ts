import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";
import { compressGifBuffer } from "../../electron/ipc/export/gifOptimization";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

const ffmpegPath = createRequire(import.meta.url)("ffmpeg-static") as string;

test.beforeEach(async ({ page }) => {
	const jobs = new Map<string, AbortController>();
	await page.exposeFunction("__compressGif", async (requestId: string, data: number[]) => {
		const controller = new AbortController();
		jobs.set(requestId, controller);
		try {
			return {
				success: true,
				data: Array.from(
					await compressGifBuffer(new Uint8Array(data), {
						ffmpegPath,
						signal: controller.signal,
					}),
				),
			};
		} catch (error) {
			return { success: false, error: String(error) };
		} finally {
			jobs.delete(requestId);
		}
	});
	await page.exposeFunction("__cancelGif", (requestId: string) => {
		jobs.get(requestId)?.abort();
		return { success: true };
	});
	page.on("close", () => {
		for (const job of jobs.values()) job.abort();
	});
	await installDesktopBridgeOverrides(page, () => {
		const native = window as unknown as {
			__compressGif: (
				id: string,
				data: number[],
			) => Promise<{ success: boolean; data?: number[]; error?: string }>;
			__cancelGif: (id: string) => Promise<{ success: boolean }>;
		};
		window.electronAPI.optimizeGif = async (id, data) => {
			const response = await native.__compressGif(id, Array.from(new Uint8Array(data)));
			return { ...response, data: response.data ? new Uint8Array(response.data) : undefined };
		};
		window.electronAPI.cancelGifOptimization = (id) => native.__cancelGif(id);
	});
});

test("free users can tick optimization without an upgrade prompt", async ({ page }) => {
	await page.goto("/tests/ui/gif-optimization.html");
	const checkbox = page.getByRole("checkbox", { name: "Optimize size" });
	await page.locator('[data-slot="checkbox-content"]').click();
	await expect(checkbox).toBeChecked();
	await expect(page.getByText("Upgrade requested")).toHaveCount(0);
});
test("users can toggle optimization and see real FFmpeg savings", async ({ page }) => {
	await page.goto("/tests/ui/gif-optimization.html");
	const checkbox = page.getByRole("checkbox", { name: "Optimize size" });
	await page.locator('[data-slot="checkbox-content"]').click();
	await expect(checkbox).toBeChecked();
	await page.locator('[data-slot="checkbox-content"]').click();
	await expect(checkbox).not.toBeChecked();
	await page.getByRole("button", { name: "Optimize sample" }).click();
	await expect(page.getByText("Frames, timing and loop preserved")).toBeVisible({
		timeout: 60000,
	});
	await expect(page.locator('div[role="status"]')).toContainText(/Saved .+\([\d.]+% smaller\)/);
	await page.screenshot({ path: "test-results/gif-optimization.png" });
});

for (const target of ["met", "missed", "failed"] as const) {
	test(`shows honest GIF optimization result when target is ${target}`, async ({ page }) => {
		await page.goto(`/tests/ui/gif-optimization.html?summary=${target}`);
		const result = page.locator('div[role="status"]');
		if (target === "failed") {
			await expect(result).toContainText("Optimization unavailable. Original GIF kept.");
			await expect(result).not.toContainText("Target not reached");
			await expect(result).not.toContainText("320 × 240");
		} else {
			await expect(result).toContainText("800 × 600 → 320 × 240");
			await expect(result).toContainText(
				target === "met" ? "90.0% smaller" : "80.0% smaller",
			);
			if (target === "missed") await expect(result).toContainText("Target not reached");
			else await expect(result).not.toContainText("Target not reached");
		}
	});
}

for (const plan of ["free", "pro", "loading", "unavailable"] as const) {
	test(`optimized local GIF exports work when billing is ${plan}`, async ({ page }) => {
		test.setTimeout(90000);
		await installDesktopBridge(page);
		await installDesktopBridgeOverrides(page, () => {
			window.electronAPI.onCloudShareProgress = () => () => undefined;
			const native = window as unknown as {
				__compressGif: (
					id: string,
					data: number[],
				) => Promise<{ success: boolean; data?: number[]; error?: string }>;
				__cancelGif: (id: string) => Promise<{ success: boolean }>;
			};
			window.electronAPI.optimizeGif = async (id, data) => {
				const response = await native.__compressGif(id, Array.from(new Uint8Array(data)));
				return {
					...response,
					data: response.data ? new Uint8Array(response.data) : undefined,
				};
			};
			window.electronAPI.cancelGifOptimization = (id) => native.__cancelGif(id);
			window.electronAPI.suggestExportFileName = async (name) =>
				name.replace(/\.gif$/, " 2.gif");
			window.electronAPI.saveExportedVideo = async (data) => {
				const bytes = new Uint8Array(data);
				document.documentElement.dataset.savedGifHeader = String.fromCharCode(
					...bytes.subarray(0, 6),
				);
				document.documentElement.dataset.savedGifBytes = String(bytes.length);
				return { success: true, path: "/exports/Renamed capture 3.gif" };
			};
			window.electronAPI.cloudBilling = async ({ action }) => {
				const prices = [{ interval: "monthly" as const, unitAmount: 900, currency: "usd" }];
				if (action === "catalog")
					return {
						success: true,
						prices,
						limits: {
							freeRecordingLimit: 5,
							freeMaxRecordingBytes: 1e9,
							plusMaxRecordingBytes: 1e10,
							storageLimitBytes: 1e11,
						},
					};
				const plan = new URLSearchParams(location.search).get("gifPlan");
				if (plan === "loading") return new Promise<never>(() => undefined);
				if (plan === "unavailable") return { success: false, error: "Billing unavailable" };
				return {
					success: true,
					billing: {
						plan:
							new URLSearchParams(location.search).get("gifPlan") === "pro"
								? "pro"
								: "free",
						subscriptionStatus: "active",
						currentPeriodEnd: null,
						cancelAtPeriodEnd: false,
						checkoutAvailable: true,
						checkoutIntervals: ["monthly"],
						portalAvailable: true,
						prices,
					},
					usage: {
						recordings: 0,
						recordingLimit:
							new URLSearchParams(location.search).get("gifPlan") === "pro"
								? null
								: 5,
						maxRecordingBytes: 1e9,
						storageBytes: 0,
						storageLimitBytes: 1e11,
					},
				};
			};
		});

		await page.goto(`/?windowType=editor&gifPlan=${plan}`);
		await expect(page.getByRole("row", { name: "Colors", exact: true })).toBeVisible({
			timeout: 15000,
		});
		await expect
			.poll(() =>
				page
					.locator("video")
					.evaluateAll((videos) =>
						videos.some((video) => (video as HTMLVideoElement).readyState >= 2),
					),
			)
			.toBe(true);
		await page.getByRole("button", { name: "Publish", exact: true }).click();
		const fileSize = page.getByRole("status", { name: "Estimated file size", exact: true });
		await expect(fileSize).toHaveCount(0);
		await page.getByRole("row", { name: "Save to device", exact: true }).click();
		await expect(fileSize).toHaveCount(0);
		await page.getByRole("row", { name: "GIF", exact: true }).click();
		const checkbox = page.getByRole("checkbox", { name: "Optimize size" });
		await expect(checkbox).not.toBeChecked();
		await page.locator('[data-slot="checkbox-content"]').filter({ has: checkbox }).click();
		await expect(checkbox).toBeChecked();
		await expect(fileSize).toHaveCount(0);
		await expect(page.getByText(/^Estimated: /)).toHaveCount(0);
		await expect(
			page.getByText(
				"Targets 90% smaller by reducing colors and resolution. Actual size may vary.",
			),
		).toBeVisible();
		await expect(page.getByText("Export complete", { exact: true })).toHaveCount(0);
		const previewCanvas = await page
			.locator("[data-preview-captions-ready] canvas")
			.first()
			.elementHandle();
		if (plan === "free")
			await page.screenshot({ path: "test-results/gif-estimate-editor.png" });
		await page.getByRole("button", { name: "Export GIF", exact: true }).click();
		const activity = page.getByRole("region", { name: "Export", exact: true });
		await expect(activity.locator("p[title]")).toHaveAttribute("title", / 2\.gif$/);
		await expect(page.getByRole("dialog", { name: "Recordly Cloud", exact: true })).toHaveCount(
			0,
		);
		await expect(page.getByText("Export complete", { exact: true })).toBeVisible({
			timeout: 60000,
		});
		await expect(activity.locator("p[title]")).toHaveAttribute(
			"title",
			"Renamed capture 3.gif",
		);
		expect(await previewCanvas.evaluate((canvas) => canvas.isConnected)).toBe(true);
		if (plan === "free") {
			const thumbnail = activity.locator("img");
			await expect(thumbnail).toHaveAttribute("src", /^data:image\/png;base64,/);
			expect(
				await thumbnail.evaluate(async (image: HTMLImageElement) => {
					await image.decode();
					const canvas = document.createElement("canvas");
					canvas.width = canvas.height = 1;
					const context = canvas.getContext("2d")!;
					context.drawImage(image, 0, 0, 1, 1);
					return context.getImageData(0, 0, 1, 1).data[3];
				}),
			).toBeGreaterThan(0);
		}
		await expect(page.locator("html")).toHaveAttribute("data-saved-gif-header", /^GIF8[79]a$/);
		await expect(page.locator("html")).toHaveAttribute("data-saved-gif-bytes", /^[1-9]\d*$/);
		await expect(page.getByText(/Saved .+\([\d.]+% smaller\)/)).toBeVisible();
		await expect(page.getByText("Optimization unavailable. Original GIF kept.")).toHaveCount(0);
		await expect(page.getByRole("dialog", { name: "Recordly Cloud", exact: true })).toHaveCount(
			0,
		);
	});
}
