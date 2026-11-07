// Local fixture APIs only; exercises the actual cloud viewer, without cloud writes.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium, webkit, expect as baseExpect } from "@playwright/test";
const expect = baseExpect.configure({ timeout: 10_000 });
const root = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.env.MOBILE_PLAYER_TEST_PORT || 5197);
const base = `http://127.0.0.1:${port}`;
const server = spawn(
	process.execPath,
	[
		fileURLToPath(new URL("../node_modules/astro/bin/astro.mjs", import.meta.url)),
		"dev",
		"--ignore-lock",
		"--host",
		"127.0.0.1",
		"--port",
		String(port),
	],
	{ cwd: root, stdio: ["ignore", "pipe", "pipe"] },
);
let output = "",
	browser;
server.stdout.on("data", (chunk) => {
	output += chunk;
});
server.stderr.on("data", (chunk) => {
	output += chunk;
});
try {
	const deadline = Date.now() + 60_000;
	while (true) {
		if (server.exitCode !== null) throw new Error(output);
		try {
			if ((await fetch(`${base}/share`)).ok) break;
		} catch {
			/* Retry until the development server starts or the deadline expires. */
		}
		if (Date.now() > deadline) throw new Error(output);
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	for (const engine of [chromium, webkit]) {
		browser = await engine.launch();
		const page = await browser.newPage({
			viewport: { width: 390, height: 844 },
			isMobile: true,
			hasTouch: true,
		});
		page.setDefaultTimeout(10_000);
		const errors = [];
		page.on("pageerror", (error) => errors.push(error.message));
		const video = {
			title: "A long mobile recording title that should stay readable",
			duration: 6,
			width: 1920,
			height: 1080,
			summary: "Mobile controls fixture",
			has_webcam: 0,
			cta_url: null,
			cta_text: null,
			created_at: "2026-10-24 00:00:00",
			view_count: 1,
			is_meeting: 0,
			feedback_enabled: false,
		};
		await page.route("**/s/**", (route) => {
			const path = new URL(route.request().url()).pathname;
			return route.fulfill({
				json: path.endsWith("/data")
					? {
							video,
							segments: [
								{
									start_time: 0,
									end_time: 6,
									text: "Readable mobile captions",
									speaker: null,
								},
							],
							chapters: [],
							shareCode: "share",
						}
					: path.endsWith("/comments")
						? { comments: [], total: 0, page: 1, limit: 50 }
						: { reactions: [] },
			});
		});
		await page.route("**/v/**", (route) =>
			route.fulfill({
				path: fileURLToPath(
					new URL("../../../../../tests/ui/fixtures/preview.mp4", import.meta.url),
				),
				contentType: "video/mp4",
			}),
		);
		await page.route("**/thumb/**", (route) => route.fulfill({ status: 404, body: "" }));
		await page.route("**/vtt/**", (route) =>
			route.fulfill({
				contentType: "text/vtt",
				body: "WEBVTT\n\n00:00.000 --> 00:06.000\nReadable mobile captions\n",
			}),
		);
		await page.goto(`${base}/share`);
		const player = page.getByRole("region", { name: "Video player" });
		await expect(player).toBeVisible();
		await expect(page.locator(".recording-meta")).not.toContainText("Invalid Date");
		await page.addStyleTag({ content: "astro-dev-toolbar {display:none!important}" });
		for (const size of [
			{ width: 320, height: 740 },
			{ width: 390, height: 844 },
			{ width: 844, height: 390 },
			{ width: 1440, height: 900 },
		]) {
			await page.setViewportSize(size);
			const controls = page.getByRole("group", { name: "Playback controls" });
			for (const name of ["Play", "Mute", "Captions", "Playback speed: 1×", "Fullscreen"]) {
				const box = await controls.getByRole("button", { name, exact: true }).boundingBox();
				const frame = await player.boundingBox();
				const minimum = size.width <= 760 || size.height <= 500 ? 44 : 32;
				expect(box.width).toBeGreaterThanOrEqual(minimum);
				expect(box.height).toBeGreaterThanOrEqual(minimum);
				expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width + 1);
			}
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
			).toBe(true);
			if (size.width === 844)
				await expect(
					page.getByRole("complementary", { name: "Recording feedback" }),
				).toBeHidden();
			await page.screenshot({
				path: `/tmp/recordly-mobile-${engine.name()}-${size.width}.png`,
				fullPage: true,
			});
		}
		await page.setViewportSize({ width: 390, height: 844 });
		await page.getByRole("button", { name: "Comments", exact: true }).tap();
		await expect(
			page.getByText("The creator has turned off new comments and reactions."),
		).toBeVisible();
		await page.getByRole("button", { name: "Back to video" }).tap();
		await expect(player).toBeVisible();
		await page.getByRole("button", { name: "Playback speed: 1×" }).tap();
		await page.getByRole("menuitemradio", { name: "1.5×", exact: true }).tap();
		await expect(page.getByRole("button", { name: "Playback speed: 1.5×" })).toBeVisible();
		if (engine === chromium) {
			await page.getByRole("button", { name: "Fullscreen", exact: true }).tap();
			await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
			await expect(page.getByRole("button", { name: "Exit fullscreen" })).toBeVisible();
			await page.getByRole("button", { name: "Playback speed: 1.5×" }).tap();
			await page.getByRole("menuitemradio", { name: "1×", exact: true }).tap();
			const box = await player.boundingBox();
			const viewport = page.viewportSize();
			expect(Math.round(box.height)).toBe(viewport.height);
			await page.getByRole("button", { name: "Exit fullscreen" }).tap();
			await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
			// A first touch on a playing video with hidden controls reveals them without pausing.
			await page.getByRole("button", { name: "Play recording", exact: true }).tap();
			await page.locator("video").evaluate((v) => {
				v.loop = true;
				v.playbackRate = 0.5;
			});
			await expect(player).toHaveAttribute("data-controls-visible", "false");
			const stage = await page.locator("video").boundingBox();
			await page.touchscreen.tap(stage.x + stage.width / 2, stage.y + stage.height / 3);
			await expect(player).toHaveAttribute("data-controls-visible", "true");
			expect(await page.locator("video").evaluate((v) => v.paused)).toBe(false);
			await page.getByRole("button", { name: "Pause", exact: true }).tap();
		}
		// Simulate the iPhone capability surface; WebKit desktop alone cannot validate iOS native UI.
		await page.evaluate(() => {
			Object.defineProperty(document, "fullscreenEnabled", {
				configurable: true,
				value: false,
			});
			const shell = document.querySelector(".video-shell");
			shell.webkitRequestFullscreen = undefined;
			const video = document.querySelector("video");
			video.webkitEnterFullscreen = () => {
				Object.defineProperty(video, "webkitDisplayingFullscreen", {
					configurable: true,
					value: true,
				});
				video.dispatchEvent(new Event("webkitbeginfullscreen"));
			};
			video.webkitExitFullscreen = () => {
				Object.defineProperty(video, "webkitDisplayingFullscreen", {
					configurable: true,
					value: false,
				});
				video.dispatchEvent(new Event("webkitendfullscreen"));
			};
		});
		await page.getByRole("button", { name: "Fullscreen", exact: true }).tap();
		await expect(page.getByRole("button", { name: "Exit fullscreen" })).toBeVisible();
		await expect
			.poll(() => page.locator("video").evaluate((v) => v.textTracks[0]?.mode))
			.toBe("showing");
		await page.getByRole("button", { name: "Captions", exact: true }).tap();
		await expect
			.poll(() => page.locator("video").evaluate((v) => v.textTracks[0]?.mode))
			.toBe("hidden");
		await page.getByRole("button", { name: "Captions", exact: true }).tap();
		await expect
			.poll(() => page.locator("video").evaluate((v) => v.textTracks[0]?.mode))
			.toBe("showing");
		await page.getByRole("button", { name: "Exit fullscreen" }).tap();
		await expect
			.poll(() => page.locator("video").evaluate((v) => v.textTracks[0]?.mode))
			.toBe("hidden");
		expect(errors).toEqual([]);
		console.log(
			`PASS ${engine.name()}: 320/390/844/1440 layouts, touch targets, feedback, speed, fullscreen and native caption fallback`,
		);
		await browser.close();
		browser = undefined;
	}
} finally {
	await browser?.close();
	server.kill("SIGTERM");
}
